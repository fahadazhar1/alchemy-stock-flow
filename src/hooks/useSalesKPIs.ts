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
  totalCustomers:    number;
  oneTimeCustomers:  number;
  repeatCustomers:   number;
  oneTimePct:        number;
  repeatPct:         number;
  oneTimeRevenue:    number;
  repeatRevenue:     number;
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
        totalCustomers:   Number(row?.total_customers    ?? 0),
        oneTimeCustomers: Number(row?.one_time_customers ?? 0),
        repeatCustomers:  Number(row?.repeat_customers   ?? 0),
        oneTimePct:       Number(row?.one_time_pct       ?? 0),
        repeatPct:        Number(row?.repeat_pct         ?? 0),
        oneTimeRevenue:   Number(row?.one_time_revenue   ?? 0),
        repeatRevenue:    Number(row?.repeat_revenue     ?? 0),
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
        .select("shopify_created_at, closed_at")
        .eq("fulfillment_status", "fulfilled")
        .gte("shopify_created_at", b.startISO)
        .lte("shopify_created_at", b.endISO)
        .is("cancelled_at", null)
        .not("closed_at", "is", null);
      if (storeId) q = q.eq("store_id", storeId);

      const { data, error } = await q;
      if (error) throw error;

      const rows = (data ?? []) as any[];
      const lags: number[] = [];
      for (const r of rows) {
        if (!r.shopify_created_at || !r.closed_at) continue;
        const lagMs = new Date(r.closed_at).getTime() - new Date(r.shopify_created_at).getTime();
        // Allow 0 ms lag (same-day fulfillment) and cap at 30 days
        if (lagMs >= 0 && lagMs < 30 * 86_400_000) lags.push(lagMs / 3_600_000);
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

// ─── Discount usage ───────────────────────────────────────────────────────────

export interface DiscountUsage {
  rate: number;
  discountedOrders: number;
  totalOrders: number;
  discountedRevenue: number;
  totalRevenue: number;
  revenueRate: number;
}

export function useDiscountUsage(bounds?: DateBounds) {
  const { storeId } = useStoreFilter();
  const b = bounds ?? getDateBounds("MTD");

  return useQuery({
    queryKey: ["discount-usage", storeId, b.startISO, b.endISO],
    queryFn: async (): Promise<DiscountUsage> => {
      let q = (supabase as any)
        .from("orders")
        .select("discount_codes, cancelled_at, total_price")
        .gte("shopify_created_at", b.startISO)
        .lte("shopify_created_at", b.endISO);
      if (storeId) q = q.eq("store_id", storeId);

      const { data, error } = await q;
      if (error) throw error;

      const rows = ((data ?? []) as any[]).filter((r: any) => !r.cancelled_at);
      const total = rows.length;
      const discountedRows = rows.filter((r: any) => r.discount_codes != null);
      const discounted = discountedRows.length;
      const rate = total > 0 ? Math.round((discounted / total) * 1000) / 10 : 0;

      const totalRevenue = rows.reduce((s: number, r: any) => s + Number(r.total_price ?? 0), 0);
      const discountedRevenue = discountedRows.reduce((s: number, r: any) => s + Number(r.total_price ?? 0), 0);
      const revenueRate = totalRevenue > 0 ? Math.round((discountedRevenue / totalRevenue) * 1000) / 10 : 0;

      return { rate, discountedOrders: discounted, totalOrders: total, discountedRevenue, totalRevenue, revenueRate };
    },
  });
}

// ─── Traffic sources ──────────────────────────────────────────────────────────

export interface TrafficSource {
  name: string;
  orders: number;
  share: number;
}

function normalizeTrafficSource(
  referringSite: string | null | undefined,
  landingSite: string | null | undefined,
  sourceName: string | null | undefined,
): string {
  let utmSource = "";
  let utmMedium = "";
  if (landingSite) {
    try {
      const url = new URL(landingSite.startsWith("http") ? landingSite : `https://placeholder.com${landingSite}`);
      utmSource = url.searchParams.get("utm_source")?.toLowerCase() ?? "";
      utmMedium = url.searchParams.get("utm_medium")?.toLowerCase() ?? "";
    } catch { /* malformed URL */ }
  }

  const ref = referringSite?.toLowerCase() ?? "";
  const sn  = sourceName?.toLowerCase()   ?? "";

  // UTM source is explicit campaign tagging — highest confidence
  if (utmSource) {
    if (utmSource === "google" || utmSource === "google-ads" || utmSource === "googleads")
      return "Search (Google UTM)";
    if (utmSource === "bing" || utmSource === "yahoo" || utmSource === "duckduckgo")
      return "Search (Organic)";
    if (utmSource.includes("facebook") || utmSource === "fb")      return "Facebook";
    if (utmSource.includes("instagram") || utmSource === "ig")     return "Instagram";
    if (utmSource.includes("youtube")   || utmSource === "yt")     return "YouTube";
    if (utmSource.includes("tiktok")    || utmSource === "tt")     return "TikTok";
    if (utmSource.includes("twitter")   || utmSource === "x" || utmSource === "t.co") return "Twitter / X";
    if (utmSource.includes("pinterest"))                            return "Pinterest";
    if (utmSource.includes("linkedin"))                             return "LinkedIn";
    if (utmSource.includes("shopify_email") || utmSource === "klaviyo" || utmMedium === "email")
      return "Shopify Email";
    if (utmSource.includes("chatgpt") || utmSource === "openai")   return "ChatGPT";
    // Surface the raw utm_source so nothing is silently swallowed into "Direct"
    return utmSource.charAt(0).toUpperCase() + utmSource.slice(1);
  }

  // Shopify source_name reveals the sales channel for social commerce & POS
  if (sn && sn !== "web") {
    if (sn === "email" || sn === "shopify_email")  return "Shopify Email";
    if (sn.includes("facebook"))                   return "Facebook";
    if (sn.includes("instagram"))                  return "Instagram";
    if (sn.includes("google"))                     return "Search (Google UTM)";
    if (sn === "pos")                              return "POS";
  }

  // HTTP referrer — no UTM, so this is organic/direct navigation
  if (ref) {
    if (ref.includes("chatgpt.com") || ref.includes("chat.openai.com")) return "ChatGPT";
    if (ref.includes("google.")    || ref.includes("google.com"))  return "Search (Organic)";
    if (ref.includes("bing.com")   || ref.includes("yahoo.com")   ||
        ref.includes("duckduckgo.com") || ref.includes("baidu.com")) return "Search (Organic)";
    if (ref.includes("facebook.com") || ref.includes("fb.com") || ref.includes("l.facebook"))
      return "Facebook";
    if (ref.includes("instagram.com") || ref.includes("l.instagram")) return "Instagram";
    if (ref.includes("youtube.com")   || ref.includes("youtu.be"))    return "YouTube";
    if (ref.includes("tiktok.com"))   return "TikTok";
    if (ref.includes("twitter.com")   || ref.includes("t.co"))        return "Twitter / X";
    if (ref.includes("pinterest.com")) return "Pinterest";
    if (ref.includes("linkedin.com"))  return "LinkedIn";
    if (ref.includes("reddit.com"))    return "Reddit";
    // Unknown referrer — show the domain rather than hiding it as "Direct"
    try {
      return new URL(ref.startsWith("http") ? ref : `https://${ref}`).hostname.replace(/^www\./, "");
    } catch { return "Other"; }
  }

  return "Direct / None";
}

export function useTrafficSources(bounds?: DateBounds) {
  const { storeId } = useStoreFilter();
  const b = bounds ?? getDateBounds("MTD");

  return useQuery({
    queryKey: ["traffic-sources", storeId, b.startISO, b.endISO],
    queryFn: async (): Promise<TrafficSource[]> => {
      let q = (supabase as any)
        .from("orders")
        .select("referring_site, landing_site, source_name, cancelled_at")
        .gte("shopify_created_at", b.startISO)
        .lte("shopify_created_at", b.endISO);
      if (storeId) q = q.eq("store_id", storeId);

      const { data, error } = await q;
      if (error) throw error;

      const rows = ((data ?? []) as any[]).filter((r: any) => !r.cancelled_at);
      const sourceMap = new Map<string, number>();
      for (const r of rows) {
        const name = normalizeTrafficSource(r.referring_site, r.landing_site, r.source_name);
        sourceMap.set(name, (sourceMap.get(name) ?? 0) + 1);
      }
      const total = rows.length;
      return Array.from(sourceMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, orders]) => ({
          name,
          orders,
          share: total > 0 ? Math.round((orders / total) * 1000) / 10 : 0,
        }));
    },
  });
}

// ─── Conversion by channel ────────────────────────────────────────────────────

export interface ChannelConversion {
  name: string;
  orders: number;
  revenue: number;
  share: number;
}

export function useChannelConversion(bounds?: DateBounds) {
  const { storeId } = useStoreFilter();
  const b = bounds ?? getDateBounds("MTD");

  return useQuery({
    queryKey: ["channel-conversion", storeId, b.startISO, b.endISO],
    queryFn: async (): Promise<ChannelConversion[]> => {
      let q = (supabase as any)
        .from("orders")
        .select("source_name, total_price, cancelled_at")
        .gte("shopify_created_at", b.startISO)
        .lte("shopify_created_at", b.endISO);
      if (storeId) q = q.eq("store_id", storeId);

      const { data, error } = await q;
      if (error) throw error;

      const rows = ((data ?? []) as any[]).filter((r: any) => !r.cancelled_at);
      const map = new Map<string, { orders: number; revenue: number }>();
      for (const r of rows) {
        const name = (r.source_name as string | null) || "Unknown";
        const e = map.get(name) ?? { orders: 0, revenue: 0 };
        e.orders  += 1;
        e.revenue += Number(r.total_price ?? 0);
        map.set(name, e);
      }
      const totalOrders = rows.length;
      return Array.from(map.entries())
        .sort((a, b) => b[1].orders - a[1].orders)
        .slice(0, 5)
        .map(([name, { orders, revenue }]) => ({
          name,
          orders,
          revenue,
          share: totalOrders > 0 ? Math.round((orders / totalOrders) * 1000) / 10 : 0,
        }));
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