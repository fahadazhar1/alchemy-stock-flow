import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStoreFilter } from "./useStoreFilter";
import { type DateBounds, getDateBounds } from "@/lib/dateRanges";

export interface BundleSales {
  bundleRevenue: number;
  othersRevenue: number;
  bundleOrders: number;
  othersOrders: number;
  bundleShare: number;
  totalRevenue: number;
  bundleDelta: number | null;
}

async function fetchSplit(
  storeId: string | null,
  startISO: string,
  endISO: string
): Promise<{ bundleRevenue: number; othersRevenue: number; bundleOrders: number; othersOrders: number }> {
  // Primary: v_order_product_revenue has product_type + line_revenue pre-joined
  const { data: rows, error } = await (() => {
    let q = (supabase as any)
      .from("v_order_product_revenue")
      .select("order_id, product_type, line_revenue, quantity, unit_price")
      .gte("order_date", startISO)
      .lte("order_date", endISO)
      .is("cancelled_at", null);
    if (storeId) q = q.eq("store_id", storeId);
    return q;
  })();

  if (!error && rows) {
    return aggregate(rows);
  }

  // Fallback: order_items with nested products join
  let ordQ = (supabase as any)
    .from("orders")
    .select("id")
    .gte("shopify_created_at", startISO)
    .lte("shopify_created_at", endISO)
    .is("cancelled_at", null)
    .limit(5000);
  if (storeId) ordQ = ordQ.eq("store_id", storeId);

  const { data: ordRows } = await ordQ;
  const orderIds: string[] = (ordRows ?? []).map((r: any) => r.id);
  if (!orderIds.length) return { bundleRevenue: 0, othersRevenue: 0, bundleOrders: 0, othersOrders: 0 };

  const { data: items } = await (supabase as any)
    .from("order_items")
    .select("order_id, quantity, unit_price, products(product_type)")
    .in("order_id", orderIds);

  return aggregate(
    (items ?? []).map((r: any) => {
      const prod = Array.isArray(r.products) ? r.products[0] : r.products;
      return {
        order_id: r.order_id,
        product_type: prod?.product_type ?? null,
        line_revenue: Number(r.quantity ?? 0) * Number(r.unit_price ?? 0),
      };
    })
  );
}

function aggregate(rows: any[]): { bundleRevenue: number; othersRevenue: number; bundleOrders: number; othersOrders: number } {
  let bundleRevenue = 0;
  let othersRevenue = 0;
  const bundleOrderIds = new Set<string>();
  const othersOrderIds = new Set<string>();

  for (const r of rows) {
    const type = (r.product_type ?? "").toLowerCase();
    const rev  = Number(r.line_revenue ?? 0) || Number(r.quantity ?? 0) * Number(r.unit_price ?? 0);
    if (type === "bundle") {
      bundleRevenue += rev;
      bundleOrderIds.add(r.order_id);
    } else {
      othersRevenue += rev;
      othersOrderIds.add(r.order_id);
    }
  }

  return {
    bundleRevenue,
    othersRevenue,
    bundleOrders: bundleOrderIds.size,
    othersOrders: othersOrderIds.size,
  };
}

export function useBundleSales(bounds?: DateBounds) {
  const { storeId } = useStoreFilter();
  const b = bounds ?? getDateBounds("MTD");

  return useQuery({
    queryKey: ["bundle-sales", storeId, b.cacheKey],
    queryFn: async (): Promise<BundleSales> => {
      const [current, prev] = await Promise.all([
        fetchSplit(storeId, b.startISO, b.endISO),
        fetchSplit(storeId, b.prevStartISO, b.prevEndISO),
      ]);

      const totalRevenue = current.bundleRevenue + current.othersRevenue;
      const bundleShare  = totalRevenue > 0
        ? Math.round((current.bundleRevenue / totalRevenue) * 100)
        : 0;
      const bundleDelta  = prev.bundleRevenue > 0
        ? Math.round(((current.bundleRevenue - prev.bundleRevenue) / prev.bundleRevenue) * 100)
        : current.bundleRevenue > 0 ? 100 : null;

      return { ...current, totalRevenue, bundleShare, bundleDelta };
    },
  });
}
