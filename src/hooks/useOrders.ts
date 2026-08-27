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
  trackingNumber: string | null;
}

export interface OrdersParams {
  page: number;
  pageSize: number;
  search: string;
  status: string;
  channel: string;
  daysBack: number;
  storeId: string | null;
  codFilter?: "all" | "held" | "released";
  courierStatusFilter?: string[];
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
  const { page, pageSize, search, status, channel, daysBack, storeId, codFilter, courierStatusFilter } = params;

  return useQuery({
    queryKey: ["v2-orders", params],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      // COD filter: look up matching tracking numbers in sonic_cache before querying orders.
      // sonic_cache is populated lazily as orders are viewed, so only cached orders appear in results.
      let codTrackingNumbers: string[] | null = null;
      if (codFilter && codFilter !== "all") {
        const statuses = codFilter === "held" ? ["Unpaid", "Pending"] : ["Paid", "Processed"];
        const { data: cacheRows } = await (supabase as any)
          .from("sonic_cache")
          .select("tracking_number")
          .in("courier_payment_status", statuses)
          .limit(1000);
        codTrackingNumbers = ((cacheRows ?? []) as any[]).map((r: any) => r.tracking_number as string);
        if (codTrackingNumbers.length === 0) return { rows: [], total: 0 };
      }

      // Courier status filter: resolve matching tracking numbers from sonic_cache, then apply as server-side IN filter.
      // sonic_cache is populated lazily — only orders fetched at least once appear.
      let courierTrackingNumbers: string[] | null = null;
      let includeNoTracking = false;
      const activeStatuses = (courierStatusFilter ?? []).filter(s => s !== "no_tracking");
      includeNoTracking = (courierStatusFilter ?? []).includes("no_tracking");

      if (activeStatuses.length > 0) {
        const orParts: string[] = [];
        if (activeStatuses.includes("delivered"))        orParts.push("courier_status.ilike.%delivered%");
        if (activeStatuses.includes("out_for_delivery")) orParts.push("courier_status.ilike.%out for delivery%");
        if (activeStatuses.includes("in_transit"))       orParts.push("courier_status.ilike.%transit%");
        if (activeStatuses.includes("returned"))         orParts.push("courier_status.ilike.%return%", "courier_status.ilike.%cancelled%");

        const needsPending = activeStatuses.includes("pending");
        const trackingSet = new Set<string>();

        if (orParts.length > 0) {
          const { data: matched } = await (supabase as any)
            .from("sonic_cache").select("tracking_number")
            .or(orParts.join(",")).limit(5000);
          ((matched ?? []) as any[]).forEach((r: any) => trackingSet.add(r.tracking_number));
        }

        if (needsPending) {
          // "pending" = anything in sonic_cache that isn't a known status
          const { data: pendingRows } = await (supabase as any)
            .from("sonic_cache").select("tracking_number")
            .not("courier_status", "ilike", "%delivered%")
            .not("courier_status", "ilike", "%out for delivery%")
            .not("courier_status", "ilike", "%transit%")
            .not("courier_status", "ilike", "%return%")
            .not("courier_status", "ilike", "%cancelled%")
            .limit(5000);
          ((pendingRows ?? []) as any[]).forEach((r: any) => trackingSet.add(r.tracking_number));
        }

        courierTrackingNumbers = [...trackingSet];
        if (courierTrackingNumbers.length === 0 && !includeNoTracking) return { rows: [], total: 0 };
      } else if (includeNoTracking && (courierStatusFilter ?? []).length > 0) {
        // Only "no_tracking" selected — filter to orders with no tracking number
        courierTrackingNumbers = [];
      }

      let q = (supabase as any)
        .from("orders")
        .select(
          "id, order_number, shopify_created_at, created_at, " +
          "financial_status, fulfillment_status, cancelled_at, " +
          "total_price, source_name, store_id, tracking_number, " +
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

      if (codTrackingNumbers !== null) {
        q = q.in("tracking_number", codTrackingNumbers);
      }

      if (courierTrackingNumbers !== null) {
        if (includeNoTracking && courierTrackingNumbers.length > 0) {
          q = q.or(`tracking_number.is.null,tracking_number.in.(${courierTrackingNumbers.join(",")})`);
        } else if (includeNoTracking) {
          q = q.is("tracking_number", null);
        } else {
          q = q.in("tracking_number", courierTrackingNumbers);
        }
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
          trackingNumber: r.tracking_number ?? null,
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
