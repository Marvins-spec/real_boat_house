"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/store/useStore";
import { Navigation } from "@/components/Navigation";
import { MenuItemCard } from "@/components/MenuItemCard";
import { Cart } from "@/components/Cart";
import { OrderCard } from "@/components/OrderCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { MenuCategory, MenuItem, OrderStatus, SetMealSelectionItem } from "@/types";
import { Send, ChefHat, Cake, Wine, History, Filter, Package2 } from "lucide-react";
import { FieldGroup, Field, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function CashierPage() {
  const [customerName, setCustomerName] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<MenuCategory>("set");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [setPickerOpen, setSetPickerOpen] = useState(false);
  const [activeSet, setActiveSet] = useState<MenuItem | null>(null);
  const [slotSelections, setSlotSelections] = useState<Record<string, string[]>>({});

  const {
    posLoading,
    posError: bootstrapError,
    menuItems,
    cart,
    orders,
    addToCart,
    updateCartQuantity,
    removeFromCart,
    clearCart,
    createOrder,
  } = useStore();

  const filteredMenuItems = menuItems.filter(
    (item) => item.category === selectedCategory
  );
  const categories: { value: MenuCategory; label: string; icon: React.ReactNode }[] = [
    { value: "set", label: "Set Meals", icon: <Package2 className="h-4 w-4" /> },
    ...Array.from(new Set(menuItems.filter((m) => m.category !== "set").map((m) => m.category))).map((category) => ({
      value: category as MenuCategory,
      label: category.charAt(0).toUpperCase() + category.slice(1),
      icon:
        category === "main" ? <ChefHat className="h-4 w-4" /> :
        category === "dessert" ? <Cake className="h-4 w-4" /> :
        <Wine className="h-4 w-4" />,
    })),
  ];

  const filteredOrders =
    statusFilter === "all"
      ? orders
      : orders.filter((order) => order.status === statusFilter);

  const menuByCategory = useMemo(() => {
    const grouped: Record<string, MenuItem[]> = {};
    for (const item of menuItems) {
      if (item.category === "set") continue;
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    }
    return grouped;
  }, [menuItems]);

  const selectedSetSummary = useMemo(() => {
    if (!activeSet) return "";
    const names: string[] = [];
    for (const slot of activeSet.setSlots ?? []) {
      const picked = slotSelections[slot.id] ?? [];
      for (const pickedId of picked) {
        const menu = menuItems.find((x) => x.id === pickedId);
        if (menu) names.push(menu.name);
      }
    }
    return names.join(" + ");
  }, [activeSet, menuItems, slotSelections]);

  const isSetComplete = useMemo(() => {
    if (!activeSet) return false;
    return (activeSet.setSlots ?? []).every((slot) => (slotSelections[slot.id] ?? []).length === slot.quantity);
  }, [activeSet, slotSelections]);

  const openSetPicker = (setMenu: MenuItem) => {
    const initial: Record<string, string[]> = {};
    for (const slot of setMenu.setSlots ?? []) {
      initial[slot.id] = Array.from({ length: slot.quantity }, () => "");
    }
    setActiveSet(setMenu);
    setSlotSelections(initial);
    setSetPickerOpen(true);
  };

  const handleAddMenuItem = (item: MenuItem) => {
    if (item.category === "set") {
      openSetPicker(item);
      return;
    }
    addToCart(item);
  };

  const confirmSetSelection = () => {
    if (!activeSet || !isSetComplete) return;
    const selectionMap = new Map<string, SetMealSelectionItem>();
    for (const slot of activeSet.setSlots ?? []) {
      const picked = slotSelections[slot.id] ?? [];
      for (const pickedId of picked) {
        const menu = menuItems.find((x) => x.id === pickedId);
        if (!menu || menu.category === "set") continue;
        const existing = selectionMap.get(menu.id);
        if (existing) {
          existing.quantity += 1;
        } else {
          selectionMap.set(menu.id, {
            menuItemId: menu.id,
            menuItemName: menu.name,
            menuItemCategory: menu.category,
            quantity: 1,
          });
        }
      }
    }
    addToCart(activeSet, [...selectionMap.values()]);
    setSetPickerOpen(false);
    setActiveSet(null);
    setSlotSelections({});
  };

  const handleSubmitOrder = async () => {
    if (!customerName.trim()) {
      setError("Customer name is required");
      return;
    }

    if (cart.length === 0) {
      setError("Cart is empty");
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      await createOrder(customerName.trim());
      setCustomerName("");
    } catch (err) {
      setError("Failed to create order");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (posLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background">
        <Navigation />
        <Spinner className="h-8 w-8" />
        <p className="mt-4 text-muted-foreground">Loading menu and inventory…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <main className="mx-auto max-w-7xl p-4">
        {bootstrapError && (
          <p className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {bootstrapError}
          </p>
        )}
        <div className="mb-6">
          <h1 className="font-serif text-3xl font-bold text-foreground">Cashier</h1>
          <p className="text-muted-foreground">Take orders and manage the menu</p>
        </div>

        <Tabs defaultValue="order" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="order" className="flex items-center gap-2">
              <Send className="h-4 w-4" />
              New Order
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Order History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="order">
            <div className="grid gap-6 lg:grid-cols-3">
              {/* Menu Section */}
              <div className="lg:col-span-2">
                <Card className="border-border/50 bg-card">
                  <CardHeader className="border-b border-border/30">
                    <CardTitle>Menu</CardTitle>
                    <div className="flex flex-wrap gap-2 pt-2">
                      {categories.map((cat) => (
                        <Button
                          key={cat.value}
                          variant={
                            selectedCategory === cat.value ? "default" : "secondary"
                          }
                          size="sm"
                          onClick={() => setSelectedCategory(cat.value)}
                          className="gap-2"
                        >
                          {cat.icon}
                          {cat.label}
                        </Button>
                      ))}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {filteredMenuItems.map((item) => (
                        <MenuItemCard
                          key={item.id}
                          item={item}
                          onAdd={handleAddMenuItem}
                        />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Cart Section */}
              <div className="space-y-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="customerName">Customer Name *</FieldLabel>
                    <Input
                      id="customerName"
                      placeholder="Enter customer name"
                      value={customerName}
                      onChange={(e) => {
                        setCustomerName(e.target.value);
                        if (error) setError("");
                      }}
                      className={error && !customerName.trim() ? "border-destructive" : ""}
                    />
                  </Field>
                </FieldGroup>

                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}

                <Cart
                  items={cart}
                  onUpdateQuantity={updateCartQuantity}
                  onRemove={removeFromCart}
                  onClear={clearCart}
                />

                <Button
                  className="w-full gap-2"
                  size="lg"
                  onClick={handleSubmitOrder}
                  disabled={isSubmitting || cart.length === 0}
                >
                  {isSubmitting ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Send to Kitchen
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="history">
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v as OrderStatus | "all")}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Orders</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="cooking">Cooking</SelectItem>
                    <SelectItem value="ready">Ready</SelectItem>
                    <SelectItem value="served">Served</SelectItem>
                  </SelectContent>
                </Select>
                <Badge variant="secondary">
                  {filteredOrders.length} orders
                </Badge>
              </div>

              {filteredOrders.length === 0 ? (
                <Card className="border-border/50 bg-card">
                  <CardContent className="py-12 text-center">
                    <History className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
                    <p className="text-muted-foreground">No orders found</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {[...filteredOrders].reverse().map((order) => (
                    <OrderCard key={order.id} order={order} />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </main>
      <Dialog open={setPickerOpen} onOpenChange={setSetPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{activeSet?.name ?? "Configure Set Meal"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {(activeSet?.setSlots ?? []).map((slot) => (
              <div key={slot.id} className="space-y-2">
                <p className="text-sm font-medium capitalize">
                  Select {slot.quantity} {slot.category}
                  {slot.quantity > 1 ? "s" : ""}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(slotSelections[slot.id] ?? []).map((selectedId, idx) => (
                    <Select
                      key={`${slot.id}-${idx}`}
                      value={selectedId}
                      onValueChange={(nextId) =>
                        setSlotSelections((prev) => ({
                          ...prev,
                          [slot.id]: (prev[slot.id] ?? []).map((x, i) => (i === idx ? nextId : x)),
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={`Choose ${slot.category}`} />
                      </SelectTrigger>
                      <SelectContent>
                        {(menuByCategory[slot.category] ?? []).map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ))}
                </div>
              </div>
            ))}
            <div className="rounded-md border border-border/40 bg-muted/30 p-3 text-sm">
              <p className="font-medium">Preview</p>
              <p className="text-muted-foreground">
                {activeSet?.name}: {selectedSetSummary || "Select all slots to preview"}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSetPickerOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmSetSelection} disabled={!isSetComplete}>
              Add Set to Cart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
