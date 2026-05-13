import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStoreFilter } from "./useStoreFilter";
import type { DateBounds } from "@/lib/dateRanges";
import { getDateBounds } from "@/lib/dateRanges";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SalesKPIs {
  revenueMTD: number;
  ordersMTD: number;
  aov: number;
  sellThrough: number;
  refundRate: number;
  refundAmountRate: number;
  refundedRevenue: number;
  pendingOrders: number;
  pendingApprovals: number;
  prevRevenue: number;
  prevOrders: number;
  revenueDelta: number | null;
  ordersDelta: number | null;
}

export interface CollectionSale {
  name: string;
  revenue: number;
  color: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CAT_COLORS = ["#5E5CE6", "#EC4899", "#10B981", "#F59E0B", "#06B6D4"];

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useSalesKPIs(bounds?: DateBounds) {
  const { storeId } = useStoreFilter();
  const b = bounds ?? getDateBounds("MTD");

  return useQuery({
    queryKey: ["sales-kpis", storeId, b.startISO],
    queryFn: async (): Promise<SalesKPIs> => {
      let mtdQ = (supabase as any)
        .from("orders")
        .select("total_price, cancelled_at, financial_status")
        .gte("shopify_created_at", b.startISO)
        .lte("shopify_created_at", b.endISO);
      if (storeId) mtdQ = mtdQ.eq("store_id", storeId);

      let prevQ = (supabase as any)
        .from("orders")
        .select("total_price, cancelled_at")
        .gte("shopify_created_at", b.prevStartISO)
        .lte("shopify_created_at", b.prevEndISO);
      if (storeId) prevQ = prevQ.eq("store_id", storeId);

      let pendingQ = (supabase as any)
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("financial_status", "paid")
        .is("fulfillment_status", null)
        .is("cancelled_at", null);
      if (storeId) pendingQ = pendingQ.eq("store_id", storeId);

      const kpiQ = supabase
        .from("v_dashboard_kpis")
        .select("sell_through_ratio_current_month, pending_approvals_count")
        .single();

      const [mtdRes, prevRes, pendingRes, kpiRes] = await Promise.all([
        mtdQ, prevQ, pendingQ, kpiQ,
      ]);

      if (mtdRes.error) throw mtdRes.error;

      const rows     = ((mtdRes.data ?? []) as any[]).filter((r: any) => !r.cancelled_at);
      const prevRows = ((prevRes.data ?? []) as any[]).filter((r: any) => !r.cancelled_at);

      const revenueMTD = rows.reduce((s: number, r: any) => s + Number(r.total_price ?? 0), 0);
      const ordersMTD  = rows.length;
      const aov        = ordersMTD > 0 ? revenueMTD / ordersMTD : 0;

      // Refund calculations — includes both fully and partially refunded
      const refundedRows    = rows.filter((r: any) =>
        r.financial_status === "refunded" || r.financial_status === "partially_refunded"
      );
      const refundedRevenue  = refundedRows.reduce((s: number, r: any) => s + Number(r.total_price ?? 0), 0);
      const refundRate       = ordersMTD > 0 ? Math.round((refundedRows.length / ordersMTD) * 1000) / 10 : 0;
      const refundAmountRate = revenueMTD > 0 ? Math.round((refundedRevenue / revenueMTD) * 1000) / 10 : 0;

      const prevRevenue = prevRows.reduce((s: number, r: any) => s + Number(r.total_price ?? 0), 0);
      const prevOrders  = prevRows.length;

      const revenueDelta = prevRevenue > 0
        ? Math.round(((revenueMTD - prevRevenue) / prevRevenue) * 100)
        : null;
      const ordersDelta = prevOrders > 0
        ? Math.round(((ordersMTD - prevOrders) / prevOrders) * 100)
        : null;

      const kpiRow = kpiRes.data as any;

      return {
        revenueMTD,
        ordersMTD,
        aov,
        sellThrough:      Number(kpiRow?.sell_through_ratio_current_month ?? 0),
        refundRate,
        refundAmountRate,
        refundedRevenue,
        pendingOrders:    pendingRes.count ?? 0,
        pendingApprovals: Number(kpiRow?.pending_approvals_count ?? 0),
        prevRevenue,
        prevOrders,
        revenueDelta,
        ordersDelta,
      };
    },
  });
}

// ─── Customer metrics ──────────────────────────────────────────────────────────

export interface CustomerMetrics {
  uniqueCustomers: number;
  repeatCustomers: number;
  retentionRate: number;
  ltv: number;
}

export function useCustomerMetrics(bounds?: DateBounds) {
  const { storeId } = useStoreFilter();
  const b = bounds ?? getDateBounds("MTD");

  return useQuery({
    queryKey: ["customer-metrics", storeId, b.startISO, b.endISO],
    queryFn: async (): Promise<CustomerMetrics> => {
      const { data, error } = await (supabase as any).rpc("get_customer_metrics", {
        p_start_iso: b.startISO,
        p_end_iso:   b.endISO,
        p_store_id:  storeId ?? null,
      });

      if (error) throw error;

      const row = (Array.isArray(data) ? data[0] : data) as any;
      return {
        uniqueCustomers: Number(row?.unique_customers ?? 0),
        repeatCustomers: Number(row?.repeat_customers ?? 0),
        retentionRate:   Number(row?.retention_rate   ?? 0),
        ltv:             Number(row?.ltv              ?? 0),
      };
    },
  });
}

// ─── Fulfillment metrics ───────────────────────────────────────────────────────

export interface FulfillmentMetrics {
  avgLagHours: number;
  ordersAnalyzed: number;
}

export function useFulfillmentMetrics(bounds?: DateBounds) {
  const { storeId } = useStoreFilter();
  const b = bounds ?? getDateBounds("MTD");

  return useQuery({
    queryKey: ["fulfillment-metrics", storeId, b.startISO, b.endISO],
    queryFn: async (): Promise<FulfillmentMetrics> => {
      let q = (supabase as any)
        .from("orders")
        .select("shopify_created_at, updated_at")
        .eq("fulfillment_status", "fulfilled")
        .gte("shopify_created_at", b.startISO)
        .lte("shopify_created_at", b.endISO)
        .is("cancelled_at", null);
      if (storeId) q = q.eq("store_id", storeId);

      const { data, error } = await q;
      if (error) throw error;

      const rows = (data ?? []) as any[];
      const lags: number[] = [];
      for (const r of rows) {
        if (!r.shopify_created_at || !r.updated_at) continue;
        const lagMs = new Date(r.updated_at).getTime() - new Date(r.shopify_created_at).getTime();
        if (lagMs > 0 && lagMs < 30 * 86_400_000) lags.push(lagMs / 3_600_000);
      }

      const avgLagHours = lags.length > 0
        ? lags.reduce((s, v) => s + v, 0) / lags.length
        : 0;

      return {
        avgLagHours: Math.round(avgLagHours * 10) / 10,
        ordersAnalyzed: lags.length,
      };
    },
  });
}

export function useCollectionSales(bounds?: DateBounds) {
  const { storeId } = useStoreFilter();
  const b = bounds ?? getDateBounds("MTD");

  return useQuery({
    queryKey: ["collection-sales", storeId, b.startISO, b.endISO],
    queryFn: async (): Promise<CollectionSale[]> => {
      let ordQ = (supabase as any)
        .from("orders")
        .select("id")
        .gte("shopify_created_at", b.startISO)
        .lte("shopify_created_at", b.endISO)
        .is("cancelled_at", null)
        .limit(5000);
      if (storeId) ordQ = ordQ.eq("store_id", storeId);

      const { data: ordRows, error: oErr } = await ordQ;
      if (oErr) throw oErr;

      const orderIds: string[] = (ordRows ?? []).map((r: any) => r.id as string);
      if (!orderIds.length) return [];

      const { data: items, error: iErr } = await (supabase as any)
        .from("order_items")
        .select("product_id, quantity, unit_price")
        .in("order_id", orderIds);
      if (iErr) throw iErr;

      const productRevMap = new Map<string, number>();
      for (const r of (items ?? []) as any[]) {
        const rev = Number(r.quantity ?? 0) * Number(r.unit_price ?? 0);
        productRevMap.set(r.product_id, (productRevMap.get(r.product_id) ?? 0) + rev);
      }
      const productIds = Array.from(productRevMap.keys());
      if (!productIds.length) return [];

      const collectionMap = new Map<string, string>();

      const { data: pcRows, error: pcErr } = await (supabase as any)
        .from("product_collections")
        .select("product_id, collection_id")
        .in("product_id", productIds);

      if (!pcErr && pcRows?.length) {
        const collectionIds = [...new Set((pcRows as any[]).map((r: any) => r.collection_id))];
        const { data: collRows } = await (supabase as any)
          .from("collections")
          .select("id, name")
          .in("id", collectionIds);
        const collIdToName = new Map<string, string>();
        for (const c of (collRows ?? []) as any[]) collIdToName.set(c.id, c.name);
        for (const r of (pcRows as any[])) {
          if (!collectionMap.has(r.product_id)) {
            const name = collIdToName.get(r.collection_id);
            if (name) collectionMap.set(r.product_id, name);
          }
        }
      }

      const unmapped = productIds.filter(id => !collectionMap.has(id));
      if (unmapped.length > 0) {
        const { data: prodRows } = await (supabase as any)
          .from("products")
          .select("id, product_type")
          .in("id", unmapped);
        for (const p of (prodRows ?? []) as any[]) {
          if (p.product_type) collectionMap.set(p.id, p.product_type);
        }
      }

      const revenueByCollection = new Map<string, number>();
      for (const [productId, revenue] of productRevMap.entries()) {
        const name = collectionMap.get(productId) ?? "Other";
        revenueByCollection.set(name, (revenueByCollection.get(name) ?? 0) + revenue);
      }

      return Array.from(revenueByCollection.entries())
        .filter(([, revenue]) => revenue > 0)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([name, revenue], i) => ({ name, revenue, color: CAT_COLORS[i % CAT_COLORS.length] }));
    },
  });
}