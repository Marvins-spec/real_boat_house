"use client";

import { create } from "zustand";
import { Order, OrderStatus, Ingredient, MenuItem, CartItem, SetMealSelectionItem } from "@/types";
import { mockMenuItems } from "@/services/mockData";
import { orderService, fetchOrders, CreateOrderData } from "@/services/orderService";
import { stockService } from "@/services/stockService";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import { v4 as uuidv4 } from "uuid";

interface AppState {
  baseMenu: MenuItem[];
  menuItems: MenuItem[];
  ingredients: Ingredient[];
  orders: Order[];
  cart: CartItem[];

  posLoading: boolean;
  posReady: boolean;
  posError: string | null;

  addToCart: (menuItem: MenuItem, setSelection?: SetMealSelectionItem[]) => void;
  removeFromCart: (cartItemId: string) => void;
  updateCartQuantity: (cartItemId: string, quantity: number) => void;
  clearCart: () => void;

  /** Loads orders, ingredients, menu, and (when configured) wires realtime. Returns unsubscribe for realtime. */
  bootstrap: () => Promise<() => void>;

  createOrder: (customerName: string) => Promise<Order>;
  updateOrderStatus: (orderId: string, status: OrderStatus) => Promise<void>;
  assignChef: (orderId: string, chefName: string) => Promise<void>;
  assignServer: (orderId: string, serverName: string) => Promise<void>;
  canProcessOrder: (orderId: string) => Promise<boolean>;
  loadOrders: () => Promise<void>;
  syncAfterOrderEvent: () => Promise<void>;

  updateIngredient: (ingredientId: string, updates: Partial<Ingredient>) => Promise<void>;
  addIngredient: (ingredient: Omit<Ingredient, "id">) => Promise<void>;
  deleteIngredient: (ingredientId: string) => Promise<void>;

  updateMenuItem: (menuItemId: string, updates: Partial<MenuItem>) => void;
  addMenuItem: (menuItem: Omit<MenuItem, "id">) => void;
  deleteMenuItem: (menuItemId: string) => void;
  saveMenuRecipe: (menuItemId: string, recipe: { ingredientId: string; quantity: number }[]) => Promise<void>;
  saveSetMeal: (
    setId: string | null,
    name: string,
    slots: { category: string; quantity: number }[]
  ) => Promise<void>;
  deleteSetMeal: (setId: string) => Promise<void>;

  resetSalesData: () => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
    baseMenu: mockMenuItems,
    menuItems: mockMenuItems,
    ingredients: [] as Ingredient[],
    orders: [] as Order[],
    cart: [],

    posLoading: true,
    posReady: false,
    posError: null,

    addToCart: (menuItem, setSelection) => {
      const { cart } = get();
      const existingItem = menuItem.category === "set"
        ? null
        : cart.find((item) => item.menuItem.id === menuItem.id && !item.setSelection);
      if (existingItem) {
        set({
          cart: cart.map((item) =>
            item.id === existingItem.id
              ? { ...item, quantity: item.quantity + 1 }
              : item
          ),
        });
      } else {
        set({
          cart: [
            ...cart,
            { id: uuidv4(), menuItem, quantity: 1, setSelection: setSelection ? [...setSelection] : undefined },
          ],
        });
      }
    },

    removeFromCart: (cartItemId) => {
      set({ cart: get().cart.filter((item) => item.id !== cartItemId) });
    },

    updateCartQuantity: (cartItemId, quantity) => {
      if (quantity <= 0) {
        get().removeFromCart(cartItemId);
        return;
      }
      set({
        cart: get().cart.map((item) =>
          item.id === cartItemId ? { ...item, quantity } : item
        ),
      });
    },

    clearCart: () => set({ cart: [] }),

    bootstrap: async () => {
      set({ posLoading: true, posError: null });
      let unsub: (() => void) | null = null;
      try {
        const base = await stockService.fetchMenuItems();
        const ingredients = await stockService.fetchIngredients();
        const menuItems = stockService.markMenuAvailability(base, ingredients);
        const orders = await fetchOrders();
        set({
          baseMenu: base,
          menuItems,
          ingredients,
          orders,
          posReady: true,
          posLoading: false,
        });
        if (isSupabaseConfigured()) {
          const { subscribeToOrders } = await import("@/services/supabaseService");
          unsub = subscribeToOrders(() => {
            get().syncAfterOrderEvent();
          });
        }
        return () => {
          unsub?.();
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load data";
        set({ posError: msg, posLoading: false, posReady: true });
        return () => {
          unsub?.();
        };
      }
    },

    createOrder: async (customerName) => {
      const { cart, baseMenu } = get();
      const payload: CreateOrderData = {
        customerName,
        items: cart.map((c) => ({
          menuItemId: c.menuItem.id,
          quantity: c.quantity,
          setSelection: c.setSelection ? [...c.setSelection] : undefined,
        })),
      };
      const newOrder = await orderService.createOrder(payload);
      const orders = await fetchOrders();
      set({ orders, cart: [] });
      const ingredients = await stockService.fetchIngredients();
      const latestMenu = await stockService.fetchMenuItems();
      set({
        ingredients,
        baseMenu: latestMenu,
        menuItems: stockService.markMenuAvailability(latestMenu, ingredients),
      });
      return newOrder;
    },

    updateOrderStatus: async (orderId, status) => {
      await orderService.updateOrderStatus(orderId, status);
      const orders = await fetchOrders();
      set({ orders });
      if (isSupabaseConfigured()) {
        const ingredients = await stockService.fetchIngredients();
        const latestMenu = await stockService.fetchMenuItems();
        set({
          ingredients,
          baseMenu: latestMenu,
          menuItems: stockService.markMenuAvailability(latestMenu, ingredients),
        });
      }
    },

    assignChef: async (orderId, chefName) => {
      const updated = await orderService.assignChef(orderId, chefName);
      set({
        orders: get().orders.map((o) => (o.id === orderId ? updated : o)),
      });
    },

    assignServer: async (orderId, serverName) => {
      const updated = await orderService.assignServer(orderId, serverName);
      set({
        orders: get().orders.map((o) => (o.id === orderId ? updated : o)),
      });
    },

    canProcessOrder: (orderId) => stockService.canProcessOrder(orderId),

    loadOrders: async () => {
      const orders = await fetchOrders();
      set({ orders });
    },

    syncAfterOrderEvent: async () => {
      const orders = await fetchOrders();
      const ingredients = await stockService.fetchIngredients();
      const latestMenu = await stockService.fetchMenuItems();
      set({
        orders,
        ingredients,
        baseMenu: latestMenu,
        menuItems: stockService.markMenuAvailability(latestMenu, ingredients),
      });
    },

    updateIngredient: async (ingredientId, updates) => {
      const updated = await stockService.updateIngredient(
        get().ingredients,
        ingredientId,
        updates
      );
      set({
        ingredients: updated,
        menuItems: stockService.markMenuAvailability(get().baseMenu, updated),
      });
    },

    addIngredient: async (ingredient) => {
      const updated = await stockService.addIngredient(get().ingredients, ingredient);
      set({
        ingredients: updated,
        menuItems: stockService.markMenuAvailability(get().baseMenu, updated),
      });
    },

    deleteIngredient: async (ingredientId) => {
      const updated = await stockService.deleteIngredient(get().ingredients, ingredientId);
      set({
        ingredients: updated,
        menuItems: stockService.markMenuAvailability(get().baseMenu, updated),
      });
    },

    updateMenuItem: (menuItemId, updates) => {
      const base = get().baseMenu.map((item) =>
        item.id === menuItemId ? { ...item, ...updates } : item
      );
      set({
        baseMenu: base,
        menuItems: stockService.markMenuAvailability(base, get().ingredients),
      });
    },

    addMenuItem: (menuItem) => {
      const newItem: MenuItem = { ...menuItem, id: `menu-${Date.now()}` };
      const base = [...get().baseMenu, newItem];
      set({
        baseMenu: base,
        menuItems: stockService.markMenuAvailability(base, get().ingredients),
      });
    },

    deleteMenuItem: (menuItemId) => {
      const base = get().baseMenu.filter((item) => item.id !== menuItemId);
      set({
        baseMenu: base,
        menuItems: stockService.markMenuAvailability(base, get().ingredients),
      });
    },

    saveMenuRecipe: async (menuItemId, recipe) => {
      await stockService.saveMenuRecipe(menuItemId, recipe);
      const latestMenu = await stockService.fetchMenuItems();
      set({
        baseMenu: latestMenu,
        menuItems: stockService.markMenuAvailability(latestMenu, get().ingredients),
      });
    },

    saveSetMeal: async (setId, name, slots) => {
      await stockService.saveSetMeal(setId, name, slots);
      const latestMenu = await stockService.fetchMenuItems();
      set({
        baseMenu: latestMenu,
        menuItems: stockService.markMenuAvailability(latestMenu, get().ingredients),
      });
    },

    deleteSetMeal: async (setId) => {
      await stockService.deleteSetMeal(setId);
      const latestMenu = await stockService.fetchMenuItems();
      set({
        baseMenu: latestMenu,
        menuItems: stockService.markMenuAvailability(latestMenu, get().ingredients),
      });
    },

    resetSalesData: async () => {
      await orderService.deleteAllOrders();
      set({ orders: [] });
    },
}));
