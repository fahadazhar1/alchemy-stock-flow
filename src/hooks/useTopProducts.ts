import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStoreFilter } from "./useStoreFilter";
import { type DateBounds, getDateBounds } from "@/lib/dateRanges";

export interface TopProduct {
  product_id: string;
  name: string;
  sku: string;
  vendor: string;
  units: number;
  revenue: number;
  trend: number | null;
}

async function fetchItemsForOrders(orderIds: string[]): Promise<any[]> {
  if (!orderIds.length) return [];
  const CHUNK = 200;
  const all: any[] = [];
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const chunk = orderIds.slice(i, i + CHUNK);
    const { data, error } = await (supabase as any)
      .from("order_items")
      .select("product_id, quantity, unit_price, products(name, sku, product_type, vendors(name))")
      .in("order_id", chunk)
      .limit(5000);
    if (error) throw error;
    all.push(...(data ?? []));
  }
  return all;
}

async function fetchPrevItemsForOrders(orderIds: string[]): Promise<any[]> {
  if (!orderIds.length) return [];
  const CHUNK = 200;
  const all: any[] = [];
  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const chunk = orderIds.slice(i, i + CHUNK);
    const { data } = await (supabase as any)
      .from("order_items")
      .select("product_id, quantity, unit_price")
      .in("order_id", chunk)
      .limit(5000);
    all.push(...(data ?? []));
  }
  return all;
}

export function useTopProducts(limit = 6, bounds?: DateBounds) {
  const { storeId } = useStoreFilter();
  const b = bounds ?? getDateBounds("MTD");

  return useQuery({
    queryKey: ["top-products", storeId, limit, b.cacheKey],
    queryFn: async (): Promise<TopProduct[]> => {
      // ── Current period orders ─────────────────────────────────────────────
      let ordQ = (supabase as any)
        .from("orders")
        .select("id")
        .gte("shopify_created_at", b.startISO)
        .lte("shopify_created_at", b.endISO)
        .is("cancelled_at", null)
        .neq("financial_status", "refunded")
        .limit(10000);
      if (storeId) ordQ = ordQ.eq("store_id", storeId);

      const { data: ordRows, error: oErr } = await ordQ;
      if (oErr) throw oErr;
      const orderIds: string[] = (ordRows ?? []).map((r: any) => r.id as string);
      if (!orderIds.length) return [];

      // ── Previous period orders ────────────────────────────────────────────
      let prevOrdQ = (supabase as any)
        .from("orders")
        .select("id")
        .gte("shopify_created_at", b.prevStartISO)
        .lte("shopify_created_at", b.prevEndISO)
        .is("cancelled_at", null)
        .neq("financial_status", "refunded")
        .limit(10000);
      if (storeId) prevOrdQ = prevOrdQ.eq("store_id", storeId);

      const { data: prevOrdRows } = await prevOrdQ;
      const prevOrderIds: string[] = (prevOrdRows ?? []).map((r: any) => r.id as string);

      // ── Fetch items in safe chunks ────────────────────────────────────────
      const [items, prevItems] = await Promise.all([
        fetchItemsForOrders(orderIds),
        fetchPrevItemsForOrders(prevOrderIds),
      ]);

      // ── Aggregate current period ──────────────────────────────────────────
      type Agg = { name: string; sku: string; vendor: string; units: number; revenue: number };
      const map = new Map<string, Agg>();

      for (const r of items as any[]) {
        const prod   = Array.isArray(r.products) ? r.products[0] : r.products;
        const vendor = prod?.vendors
          ? (Array.isArray(prod.vendors) ? prod.vendors[0] : prod.vendors)
          : null;
        const rev = Number(r.quantity ?? 0) * Number(r.unit_price ?? 0);
        const e   = map.get(r.product_id);
        if (e) {
          e.units   += Number(r.quantity ?? 0);
          e.revenue += rev;
        } else {
          map.set(r.product_id, {
            name:    prod?.name                            ?? "—",
            sku:     prod?.sku                             ?? "—",
            vendor:  vendor?.name ?? prod?.product_type   ?? "—",
            units:   Number(r.quantity ?? 0),
            revenue: rev,
          });
        }
      }

      // ── Aggregate previous period ─────────────────────────────────────────
      const prevMap = new Map<string, number>();
      for (const r of prevItems) {
        const rev = Number(r.quantity ?? 0) * Number(r.unit_price ?? 0);
        prevMap.set(r.product_id, (prevMap.get(r.product_id) ?? 0) + rev);
      }

      return Array.from(map.entries())
        .sort(([, a], [, b]) => b.revenue - a.revenue)
        .slice(0, limit)
        .map(([pid, p]) => {
          const prev = prevMap.get(pid) ?? 0;
          const trend: number | null = prev > 0
            ? Math.round(((p.revenue - prev) / prev) * 100)
            : null;
          return { product_id: pid, ...p, trend };
        });
    },
  });
}
