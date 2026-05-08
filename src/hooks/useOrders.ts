import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export type OrderStatus = "Pending" | "Fulfilled" | "Cancelled" | "Refunded";

export interface OrderRow {
  id: string;
  orderNumber: string;
  date: Date | null;
  storeId: string | null;
  storeName: string;
  channel: string;
  status: OrderStatus;
  paymentLabel: string;
  total: number;
}

export interface OrdersParams {
  page: number;
  pageSize: number;
  search: string;
  status: string;
  channel: string;
  daysBack: number;
  storeId: string | null;
}

export interface LiveLineItem {
  id: string;
  qty: number;
  unitPrice: number;
  total: number;
  variantSku: string;
  size: string;
  productName: string;
  vendorName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function normalizeChannel(src: string | null): string {
  const k = (src ?? "unknown").toLowerCase();
  if (k === "android" || k === "iphone") return "shop";
  return k;
}

function deriveStatus(r: any): OrderStatus {
  if (r.cancelled_at) return "Cancelled";
  if (r.financial_status === "refunded") return "Refunded";
  if (r.fulfillment_status === "fulfilled") return "Fulfilled";
  return "Pending";
}

function derivePaymentLabel(r: any): string {
  if (r.cancelled_at) return "Voided";
  const s = r.financial_status as string | null;
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useOrders(params: OrdersParams) {
  const { page, pageSize, search, status, channel, daysBack, storeId } = params;

  return useQuery({
    queryKey: ["v2-orders", params],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      let q = (supabase as any)
        .from("orders")
        .select(
          "id, order_number, shopify_created_at, created_at, " +
          "financial_status, fulfillment_status, cancelled_at, " +
          "total_price, source_name, store_id, " +
          "stores(store_name)",
          { count: "exact" }
        )
        .order("shopify_created_at", { ascending: false });

      q = q.range(page * pageSize, (page + 1) * pageSize - 1);

      if (storeId) q = q.eq("store_id", storeId);

      if (daysBack > 0) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysBack);
        q = q.gte("shopify_created_at", cutoff.toISOString());
      }

      if (search.trim()) {
        q = q.ilike("order_number", `%${search.trim()}%`);
      }

      switch (status) {
        case "Cancelled":
          q = q.not("cancelled_at", "is", null);
          break;
        case "Refunded":
          q = q.eq("financial_status", "refunded").is("cancelled_at", null);
          break;
        case "Fulfilled":
          q = q.eq("fulfillment_status", "fulfilled").is("cancelled_at", null);
          break;
        case "Pending":
          q = q.eq("financial_status", "paid")
               .is("fulfillment_status", null)
               .is("cancelled_at", null);
          break;
      }

      if (channel !== "all") {
        const targets = channel === "shop" ? ["shop", "android", "iphone"] : [channel];
        q = targets.length === 1
          ? q.eq("source_name", targets[0])
          : q.in("source_name", targets);
      }

      const { data, error, count } = await q;
      if (error) throw error;

      const rows: OrderRow[] = ((data ?? []) as any[]).map((r: any) => {
        const storeObj = Array.isArray(r.stores) ? r.stores[0] : r.stores;
        return {
          id: r.id,
          orderNumber: r.order_number,
          date: r.shopify_created_at
            ? new Date(r.shopify_created_at)
            : r.created_at ? new Date(r.created_at) : null,
          storeId: r.store_id ?? null,
          storeName: storeObj?.store_name ?? "—",
          channel: normalizeChannel(r.source_name),
          status: deriveStatus(r),
          paymentLabel: derivePaymentLabel(r),
          total: Number(r.total_price ?? 0),
        };
      });

      return { rows, total: count ?? 0 };
    },
  });
}

export function useOrderDetail(orderId: string | null) {
  return useQuery({
    queryKey: ["order-detail", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("orders")
        .select("*, stores(store_name)")
        .eq("id", orderId!)
        .single();
      if (error) throw error;
      return data as any;
    },
  });
}

export function useOrderLineItems(orderId: string | null) {
  return useQuery({
    queryKey: ["order-line-items", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_items")
        .select("id, quantity, unit_price, variants(variant_sku, size, products(name, vendors(name)))")
        .eq("order_id", orderId!);
      if (error) throw error;

      return ((data ?? []) as any[]).map((item: any): LiveLineItem => {
        const v = item.variants as any;
        const p = v?.products as any;
        const vendor = Array.isArray(p?.vendors) ? p.vendors[0] : p?.vendors;
        return {
          id: item.id,
          qty: item.quantity,
          unitPrice: item.unit_price,
          total: item.quantity * item.unit_price,
          variantSku: v?.variant_sku ?? "—",
          size: v?.size ?? "",
          productName: p?.name ?? "—",
          vendorName: vendor?.name ?? "—",
        };
      });
    },
  });
}
