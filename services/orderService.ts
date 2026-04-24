import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabaseClient";
import { mockMenuItems, mockSetMealSlots, mockSetMeals } from "@/services/mockData";
import { InsufficientStockError, SupabaseNotConfiguredError } from "@/services/posErrors";
import { MenuCategory, Order, OrderItem, OrderStatus, SetMealSelectionItem } from "@/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";

const menuById = new Map(mockMenuItems.map((m) => [m.id, m]));
for (const setMeal of mockSetMeals) {
  menuById.set(setMeal.id, {
    id: setMeal.id,
    name: setMeal.name,
    description: "",
    price: 0,
    category: "set",
    available: true,
    recipe: [],
    setMealId: setMeal.id,
    setSlots: [],
  });
}

function normalizeCategory(category?: string): MenuCategory {
  if (category === "main" || category === "drink" || category === "dessert" || category === "set") {
    return category;
  }
  return "main";
}

export type CreateOrderData = {
  customerName: string;
  items: { menuItemId: string; quantity: number; setSelection?: SetMealSelectionItem[] }[];
};

/** In-memory orders when `NEXT_PUBLIC_SUPABASE_*` is not set (UI demo; no server stock rules). */
const devOrders: Order[] = [];

function getSupabaseOrThrow() {
  const c = getSupabaseBrowserClient();
  if (!c) throw new SupabaseNotConfiguredError();
  return c;
}

async function fetchSetSlotsBySetId(
  supabase: SupabaseClient | null,
  setIds: string[]
): Promise<Record<string, { category: string; quantity: number }[]>> {
  if (!setIds.length) return {};
  if (!supabase) {
    const local: Record<string, { category: string; quantity: number }[]> = {};
    for (const slot of mockSetMealSlots) {
      if (!setIds.includes(slot.setId)) continue;
      if (!local[slot.setId]) local[slot.setId] = [];
      local[slot.setId].push({ category: slot.category, quantity: slot.quantity });
    }
    return local;
  }
  const { data, error } = await supabase
    .from("set_meal_slots")
    .select("set_id, category, quantity")
    .in("set_id", setIds);
  if (error) throw error;
  const bySet: Record<string, { category: string; quantity: number }[]> = {};
  for (const row of data ?? []) {
    const setId = row.set_id as string;
    if (!bySet[setId]) bySet[setId] = [];
    bySet[setId].push({
      category: row.category as string,
      quantity: Number(row.quantity),
    });
  }
  return bySet;
}

async function fetchMenuCategoryById(
  supabase: SupabaseClient | null,
  ids: string[]
): Promise<Record<string, string>> {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return {};
  if (!supabase) {
    return uniqueIds.reduce<Record<string, string>>((acc, id) => {
      const menu = menuById.get(id);
      if (menu) acc[id] = menu.category;
      return acc;
    }, {});
  }
  const { data, error } = await supabase.from("menu_items").select("id, category").in("id", uniqueIds);
  if (error) throw error;
  const byId: Record<string, string> = {};
  for (const row of data ?? []) {
    byId[row.id as string] = row.category as string;
  }
  return byId;
}

async function expandOrderItems(
  items: CreateOrderData["items"],
  supabase: SupabaseClient | null
): Promise<{ menuItemId: string; quantity: number; setMealId?: string; setMealName?: string; setGroupId?: string; setName?: string }[]> {
  const setIds = [...new Set(items.map((x) => x.menuItemId).filter((id) => menuById.get(id)?.category === "set"))];
  const setSlotsBySetId = await fetchSetSlotsBySetId(supabase, setIds);
  const selectedIds = items.flatMap((x) => (x.setSelection ?? []).map((s) => s.menuItemId));
  const selectedCategoryById = await fetchMenuCategoryById(supabase, selectedIds);

  return items.flatMap((item) => {
    const menu = menuById.get(item.menuItemId);
    if (menu?.category !== "set") {
      return [{ menuItemId: item.menuItemId, quantity: item.quantity }];
    }

    const selected = item.setSelection ?? [];
    const setGroupId = uuidv4();
    const required = setSlotsBySetId[menu.id] ?? [];
    if (!required.length) {
      throw new Error(`Set meal "${menu.name}" has no configured slots`);
    }

    const requiredByCategory = new Map<string, number>();
    for (const slot of required) {
      requiredByCategory.set(slot.category, (requiredByCategory.get(slot.category) ?? 0) + slot.quantity);
    }

    const selectedByCategory = new Map<string, number>();
    for (const selection of selected) {
      const category = selectedCategoryById[selection.menuItemId];
      if (!category || category === "set") {
        throw new Error("Set meal selection includes invalid menu item");
      }
      selectedByCategory.set(category, (selectedByCategory.get(category) ?? 0) + selection.quantity);
    }

    for (const [category, quantity] of requiredByCategory.entries()) {
      if ((selectedByCategory.get(category) ?? 0) !== quantity) {
        throw new Error(`Set meal "${menu.name}" requires ${quantity} item(s) in category "${category}"`);
      }
    }
    for (const category of selectedByCategory.keys()) {
      if (!requiredByCategory.has(category)) {
        throw new Error(`Category "${category}" is not valid for set meal "${menu.name}"`);
      }
    }

    return selected.map((sel) => ({
      menuItemId: sel.menuItemId,
      quantity: sel.quantity * item.quantity,
      setMealId: menu.id,
      setMealName: menu.name,
      setGroupId,
      setName: menu.name,
    }));
  });
}

async function buildOrderFromCreateData(data: CreateOrderData): Promise<Order> {
  const expanded = await expandOrderItems(data.items, null);
  const items: OrderItem[] = expanded.map((i) => {
    const m = menuById.get(i.menuItemId);
    return {
      id: uuidv4(),
      menuItemId: i.menuItemId,
      name: m?.name ?? "Unknown",
      price: m?.price ?? 0,
      quantity: i.quantity,
      category: normalizeCategory(m?.category),
      setGroupId: i.setGroupId,
      setName: i.setName,
      setMealId: i.setMealId,
      setMealName: i.setMealName,
    };
  });
  const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const now = new Date();
  return {
    id: uuidv4(),
    customerName: data.customerName,
    status: "pending",
    items,
    createdAt: now,
    updatedAt: now,
    total,
  };
}

function rowToOrderItem(row: {
  id: string;
  menu_item_id: string;
  quantity: number;
  set_group_id?: string | null;
  set_name?: string | null;
}): OrderItem {
  const m = menuById.get(row.menu_item_id);
  return {
    id: row.id,
    menuItemId: row.menu_item_id,
    name: m?.name ?? "Unknown",
    price: m?.price ?? 0,
    quantity: row.quantity,
    category: normalizeCategory(m?.category),
    setGroupId: row.set_group_id ?? undefined,
    setName: row.set_name ?? undefined,
  };
}

function mapOrderRow(
  o: {
    id: string;
    customer_name: string;
    status: OrderStatus;
    chef_name: string | null;
    server_name: string | null;
    created_at: string;
    updated_at: string;
    order_items: {
      id: string;
      menu_item_id: string;
      quantity: number;
      set_group_id?: string | null;
      set_name?: string | null;
    }[];
  }
): Order {
  const items = (o.order_items ?? []).map(rowToOrderItem);
  const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
  return {
    id: o.id,
    customerName: o.customer_name,
    status: o.status,
    chefName: o.chef_name ?? undefined,
    serverName: o.server_name ?? undefined,
    createdAt: new Date(o.created_at),
    updatedAt: new Date(o.updated_at),
    items,
    total,
  };
}

function mapRpcErrorToInsufficient(err: { message: string; details?: string; hint?: string }): boolean {
  const t = (err.message + (err.details ?? "")).toLowerCase();
  return t.includes("insufficient_stock");
}

/**
 * Fetches all orders with embedded order_items (sorted newest first).
 */
export async function fetchOrders(): Promise<Order[]> {
  if (!isSupabaseConfigured()) {
    return [...devOrders].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }
  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("orders")
    .select(
      `
      id,
      customer_name,
      status,
      chef_name,
      server_name,
      created_at,
      updated_at,
      order_items ( id, menu_item_id, quantity, set_group_id, set_name )
    `
    )
    .order("created_at", { ascending: false });

  if (error) throw error;
  if (!data) return [];
  return (data as unknown as Parameters<typeof mapOrderRow>[0][]).map(mapOrderRow);
}

export const orderService = {
  async fetchOrders(): Promise<Order[]> {
    return fetchOrders();
  },

  /**
   * Creates an order and its line items in Supabase.
   */
  async createOrder(data: CreateOrderData): Promise<Order> {
    if (data.items.length === 0) {
      throw new Error("Order must include at least one item");
    }
    if (!isSupabaseConfigured()) {
      const o = await buildOrderFromCreateData(data);
      devOrders.push(o);
      return o;
    }

    const supabase = getSupabaseOrThrow();
    const { data: orderRow, error: orderErr } = await supabase
      .from("orders")
      .insert({
        customer_name: data.customerName,
        status: "pending" as const,
      })
      .select("id, customer_name, status, chef_name, server_name, created_at, updated_at")
      .single();

    if (orderErr) throw orderErr;
    if (!orderRow) throw new Error("Failed to create order");

    const orderId = orderRow.id as string;

    const lineRows = (await expandOrderItems(data.items, supabase)).map((i) => ({
      id: uuidv4(),
      order_id: orderId,
      menu_item_id: i.menuItemId,
      quantity: i.quantity,
      set_group_id: i.setGroupId ?? null,
      set_name: i.setName ?? null,
    }));

    const { error: itemsErr } = await supabase.from("order_items").insert(lineRows);
    if (itemsErr) throw itemsErr;

    const { data: withItems, error: fetchErr } = await supabase
      .from("orders")
      .select(
        `
        id,
        customer_name,
        status,
        chef_name,
        server_name,
        created_at,
        updated_at,
        order_items ( id, menu_item_id, quantity, set_group_id, set_name )
      `
      )
      .eq("id", orderId)
      .single();

    if (fetchErr) throw fetchErr;
    if (!withItems) throw new Error("Failed to load new order");
    return mapOrderRow(withItems as Parameters<typeof mapOrderRow>[0]);
  },

  /**
   * Updates workflow status. Moving to "ready" runs stock check + atomic deduction in the database.
   */
  async updateOrderStatus(orderId: string, status: OrderStatus): Promise<Order> {
    if (!isSupabaseConfigured()) {
      const o = devOrders.find((x) => x.id === orderId);
      if (!o) throw new Error("Order not found");
      o.status = status;
      o.updatedAt = new Date();
      return { ...o, items: o.items.map((i) => ({ ...i })) };
    }

    const supabase = getSupabaseOrThrow();

    if (status === "ready") {
      const { error: rpcError } = await supabase.rpc("ready_order_with_stock", {
        p_order_id: orderId,
      });
      if (rpcError) {
        if (mapRpcErrorToInsufficient(rpcError)) {
          throw new InsufficientStockError();
        }
        throw rpcError;
      }
    } else {
      const { error: upd } = await supabase
        .from("orders")
        .update({ status })
        .eq("id", orderId);
      if (upd) throw upd;
    }

    const { data: o, error } = await supabase
      .from("orders")
      .select(
        `
        id,
        customer_name,
        status,
        chef_name,
        server_name,
        created_at,
        updated_at,
        order_items ( id, menu_item_id, quantity, set_group_id, set_name )
      `
      )
      .eq("id", orderId)
      .single();

    if (error) throw error;
    if (!o) throw new Error("Order not found");
    return mapOrderRow(o as Parameters<typeof mapOrderRow>[0]);
  },

  async assignChef(orderId: string, chefName: string): Promise<Order> {
    if (!isSupabaseConfigured()) {
      const o = devOrders.find((x) => x.id === orderId);
      if (!o) throw new Error("Order not found");
      o.chefName = chefName;
      o.updatedAt = new Date();
      return { ...o, items: o.items.map((i) => ({ ...i })) };
    }
    const supabase = getSupabaseOrThrow();
    const { error: upd } = await supabase
      .from("orders")
      .update({ chef_name: chefName })
      .eq("id", orderId);
    if (upd) throw upd;
    return orderServicePatchFetch(supabase, orderId);
  },

  async assignServer(orderId: string, serverName: string): Promise<Order> {
    if (!isSupabaseConfigured()) {
      const o = devOrders.find((x) => x.id === orderId);
      if (!o) throw new Error("Order not found");
      o.serverName = serverName;
      o.updatedAt = new Date();
      return { ...o, items: o.items.map((i) => ({ ...i })) };
    }
    const supabase = getSupabaseOrThrow();
    const { error: upd } = await supabase
      .from("orders")
      .update({ server_name: serverName })
      .eq("id", orderId);
    if (upd) throw upd;
    return orderServicePatchFetch(supabase, orderId);
  },

  getOrdersByStatus(orders: Order[], status: OrderStatus): Order[] {
    return orders.filter((order) => order.status === status);
  },

  calculateTotal(items: OrderItem[]): number {
    return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  },

  async deleteAllOrders(): Promise<void> {
    if (!isSupabaseConfigured()) {
      devOrders.length = 0;
      return;
    }
    const supabase = getSupabaseOrThrow();
    const { error } = await supabase.from("orders").delete().not("id", "is", null);
    if (error) throw error;
  },
};

async function orderServicePatchFetch(supabase: SupabaseClient, orderId: string): Promise<Order> {
  const { data: o, error } = await supabase
    .from("orders")
    .select(
      `
      id,
      customer_name,
      status,
      chef_name,
      server_name,
      created_at,
      updated_at,
      order_items ( id, menu_item_id, quantity, set_group_id, set_name )
    `
    )
    .eq("id", orderId)
    .single();
  if (error) throw error;
  if (!o) throw new Error("Order not found");
  return mapOrderRow(o as Parameters<typeof mapOrderRow>[0]);
}
