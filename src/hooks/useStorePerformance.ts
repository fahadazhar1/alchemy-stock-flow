import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DateBounds } from "@/lib/dateRanges";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StoreInfo {
  id: string;
  store_name: string;
  store_code: string;
  currency: string | null;
  currency_symbol: string | null;
}

export interface CategoryStat {
  name: string;
  revenue: number;
  units: number;
  growth: number | null; // % change vs prev period
}

export interface StoreMetrics {
  storeId: string;
  storeName: string;
  storeCode: string;
  currency: string;
  currencySymbol: string;

  // Revenue
  revenue: number;
  prevRevenue: number;
  revenueDelta: number | null;

  // Orders
  orders: number;
  prevOrders: number;
  ordersDelta: number | null;

  // Units
  unitsSold: number;

  // Refunds
  refundRate: number;       // % of orders refunded
  refundedRevenue: number;

  // AOV
  aov: number;

  // Sell-through (units sold / (units sold + current inventory))
  sellThrough: number;

  // Inventory
  totalSKUs: number;
  activeSKUs: number;
  oosCount: number;
  oosRate: number;          // % of active SKUs that are OOS
  lowStockCount: number;    // replenishment candidates
  criticalCount: number;    // high-urgency replenishment
  deadStockCount: number;
  overstockedCount: number; // dead stock Never Sold with >50 units
  inventoryHealthScore: number; // 0–100

  // Performance score (0–100, see scoreWeights comment below)
  performanceScore: number;
  prevPerformanceScore: number | null;
  scoreDelta: number | null; // current - prev
  scoreBreakdown: ScoreFactor[]; // per-factor points behind performanceScore

  // Daily revenue last 14 days (for sparklines)
  dailyRevenue: number[];

  // Top 3 collections by revenue
  topCategories: CategoryStat[];

  // AI diagnosis string
  diagnosis: string;
}

export interface GlobalSummary {
  totalRevenue: number;
  prevRevenue: number;
  revenueDelta: number | null;
  totalOrders: number;
  prevOrders: number;
  ordersDelta: number | null;
  totalUnitsSold: number;
  avgSellThrough: number;
  avgOOSRate: number;
  avgRefundRate: number;
}

export interface Opportunity {
  store: string;
  storeCode: string;
  opportunity: string;
  impact: string;
}

export interface Risk {
  store: string;
  storeCode: string;
  risk: string;
  impact: string;
  severity: "high" | "medium" | "low";
}

export interface StorePerformanceData {
  stores: StoreInfo[];
  storeMetrics: StoreMetrics[];
  globalSummary: GlobalSummary;
  opportunities: Opportunity[];
  risks: Risk[];
  insights: string[];
  // daily trend per store keyed by store code (for cross-store chart)
  crossStoreTrend: CrossStoreTrendPoint[];
}

export interface CrossStoreTrendPoint {
  date: string; // YYYY-MM-DD
  label: string;
  [storeCode: string]: number | string; // dynamic store revenue keys
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

function delta(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

function fmtC(value: number, sym: string): string {
  if (value >= 1_000_000) return `${sym}${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000)     return `${sym}${(value / 1_000).toFixed(1)}K`;
  return `${sym}${Math.round(value).toLocaleString("en-GB")}`;
}

// ─── Performance score ────────────────────────────────────────────────────────
// Weighted 0–100 score across 6 factors:
//   Revenue growth   25 pts
//   Sell-through     20 pts
//   Refund rate      20 pts (inverted — lower = better)
//   OOS rate         15 pts (inverted — lower = better)
//   Order growth     10 pts
//   Inventory health 10 pts (low dead-stock ratio = better)

export interface ScoreFactor {
  label: string;
  value: string;  // the store's metric, formatted (e.g. "+64%", "2.6%")
  points: number;
  max: number;
}

function computeScore(m: {
  revenueDelta: number | null;
  ordersDelta: number | null;
  refundRate: number;
  oosRate: number;
  sellThrough: number;
  deadStockRatio: number;
}): { score: number; factors: ScoreFactor[] } {
  const factors: ScoreFactor[] = [];
  const signed = (n: number) => `${n >= 0 ? "+" : ""}${n}%`;
  let p: number;

  // 1. Revenue growth (25 pts)
  if (m.revenueDelta !== null) {
    if      (m.revenueDelta >= 25)  p = 25;
    else if (m.revenueDelta >= 15)  p = 20;
    else if (m.revenueDelta >= 5)   p = 15;
    else if (m.revenueDelta >= 0)   p = 10;
    else if (m.revenueDelta >= -10) p = 5;
    else                            p = 0;
  } else {
    p = 12; // neutral when no prior period data
  }
  factors.push({ label: "Revenue growth", value: m.revenueDelta !== null ? signed(m.revenueDelta) : "no prior data", points: p, max: 25 });

  // 2. Sell-through (20 pts)
  if      (m.sellThrough >= 80) p = 20;
  else if (m.sellThrough >= 60) p = 16;
  else if (m.sellThrough >= 40) p = 12;
  else if (m.sellThrough >= 20) p = 6;
  else                          p = 2;
  factors.push({ label: "Sell-through", value: `${m.sellThrough.toFixed(1)}%`, points: p, max: 20 });

  // 3. Refund rate (20 pts, lower is better)
  if      (m.refundRate <= 1)  p = 20;
  else if (m.refundRate <= 2)  p = 17;
  else if (m.refundRate <= 4)  p = 13;
  else if (m.refundRate <= 6)  p = 8;
  else if (m.refundRate <= 10) p = 3;
  else                         p = 0;
  factors.push({ label: "Refund rate", value: `${m.refundRate.toFixed(1)}%`, points: p, max: 20 });

  // 4. OOS rate (15 pts, lower is better)
  if      (m.oosRate <= 5)  p = 15;
  else if (m.oosRate <= 10) p = 12;
  else if (m.oosRate <= 15) p = 8;
  else if (m.oosRate <= 25) p = 4;
  else                      p = 0;
  factors.push({ label: "Out-of-stock rate", value: `${m.oosRate.toFixed(1)}%`, points: p, max: 15 });

  // 5. Order growth (10 pts)
  if (m.ordersDelta !== null) {
    if      (m.ordersDelta >= 20)  p = 10;
    else if (m.ordersDelta >= 10)  p = 8;
    else if (m.ordersDelta >= 0)   p = 6;
    else if (m.ordersDelta >= -10) p = 3;
    else                           p = 0;
  } else {
    p = 5; // neutral
  }
  factors.push({ label: "Order growth", value: m.ordersDelta !== null ? signed(m.ordersDelta) : "no prior data", points: p, max: 10 });

  // 6. Inventory health / dead-stock ratio (10 pts)
  if      (m.deadStockRatio <= 0.05) p = 10;
  else if (m.deadStockRatio <= 0.10) p = 8;
  else if (m.deadStockRatio <= 0.20) p = 5;
  else if (m.deadStockRatio <= 0.30) p = 2;
  else                               p = 0;
  factors.push({ label: "Dead stock", value: `${(m.deadStockRatio * 100).toFixed(0)}% of SKUs`, points: p, max: 10 });

  const score = Math.min(100, Math.round(factors.reduce((s, f) => s + f.points, 0)));
  return { score, factors };
}

// ─── Inventory health score (0–100) ──────────────────────────────────────────

function computeInventoryHealth(oosRate: number, deadStockRatio: number, criticalCount: number): number {
  let s = 100;
  s -= Math.min(40, Math.round(oosRate * 1.5));       // OOS penalises up to 40 pts
  s -= Math.min(30, Math.round(deadStockRatio * 120)); // dead stock up to 30 pts
  s -= Math.min(15, criticalCount * 2);                // each critical SKU = 2 pts, max 15
  return Math.max(0, s);
}

// ─── AI Diagnosis ─────────────────────────────────────────────────────────────

function buildDiagnosis(m: StoreMetrics): string {
  const parts: string[] = [];

  if (m.revenueDelta !== null) {
    if (m.revenueDelta >= 20)
      parts.push(`Revenue surging +${m.revenueDelta}% vs previous period`);
    else if (m.revenueDelta >= 5)
      parts.push(`Revenue growing +${m.revenueDelta}%`);
    else if (m.revenueDelta <= -15)
      parts.push(`Revenue down ${Math.abs(m.revenueDelta)}% — needs attention`);
  }

  if (m.oosRate >= 20)
    parts.push(`High OOS at ${m.oosRate.toFixed(0)}% — urgent restocking`);
  else if (m.oosRate >= 10)
    parts.push(`${m.oosCount} SKUs out of stock`);

  if (m.refundRate >= 8)
    parts.push(`Refund rate elevated at ${m.refundRate.toFixed(1)}%`);
  else if (m.refundRate <= 1.5 && m.orders > 5)
    parts.push(`Excellent refund rate ${m.refundRate.toFixed(1)}%`);

  if (m.deadStockCount >= 30)
    parts.push(`${m.deadStockCount} dead-stock SKUs need clearance`);

  if (m.criticalCount > 0)
    parts.push(`${m.criticalCount} SKU${m.criticalCount > 1 ? "s" : ""} critically low on stock`);

  if (m.sellThrough >= 70 && parts.length === 0)
    parts.push(`Strong sell-through at ${m.sellThrough.toFixed(0)}%`);
  else if (m.sellThrough < 15 && m.unitsSold > 0)
    parts.push(`Low sell-through at ${m.sellThrough.toFixed(0)}%`);

  if (parts.length === 0) {
    if (m.performanceScore >= 70) return "Store operating well across all key metrics.";
    if (m.performanceScore >= 50) return "Performance at average levels. Monitor inventory and refunds.";
    return "Multiple metrics need attention. Review inventory and sales strategy.";
  }

  return parts.join(". ") + ".";
}

// ─── Opportunities ────────────────────────────────────────────────────────────

function buildOpportunities(metrics: StoreMetrics[]): Opportunity[] {
  const out: Opportunity[] = [];

  for (const m of metrics) {
    // Critical stock + active sales = reorder opportunity
    if (m.criticalCount >= 3) {
      out.push({
        store: m.storeName,
        storeCode: m.storeCode,
        opportunity: `${m.criticalCount} high-velocity SKUs approaching stockout`,
        impact: `Reorder now to prevent ${fmtC(m.revenue * 0.15, m.currencySymbol)} in lost sales`,
      });
    }

    // Strong growth + healthy inventory = scale opportunity
    if (m.revenueDelta !== null && m.revenueDelta >= 15 && m.oosRate <= 10) {
      out.push({
        store: m.storeName,
        storeCode: m.storeCode,
        opportunity: `Strong growth momentum (+${m.revenueDelta}%) with healthy inventory levels`,
        impact: `Potential to sustain ${fmtC(m.revenue * 1.12, m.currencySymbol)} next period`,
      });
    }

    // Top category growing well
    const topCat = m.topCategories[0];
    if (topCat && topCat.growth !== null && topCat.growth >= 25) {
      out.push({
        store: m.storeName,
        storeCode: m.storeCode,
        opportunity: `"${topCat.name}" category growing ${topCat.growth}% — expand inventory`,
        impact: `${fmtC(topCat.revenue, m.currencySymbol)} revenue this period`,
      });
    }

    // Dead stock = liquidation opportunity
    if (m.deadStockCount >= 20 && m.overstockedCount >= 5) {
      out.push({
        store: m.storeName,
        storeCode: m.storeCode,
        opportunity: `${m.deadStockCount} dead-stock SKUs — launch a clearance campaign`,
        impact: "Free up warehouse space and recover capital",
      });
    }
  }

  return out.slice(0, 6);
}

// ─── Risks ────────────────────────────────────────────────────────────────────

function buildRisks(metrics: StoreMetrics[]): Risk[] {
  const out: Risk[] = [];

  for (const m of metrics) {
    if (m.refundRate >= 6) {
      out.push({
        store: m.storeName,
        storeCode: m.storeCode,
        risk: `Refund rate at ${m.refundRate.toFixed(1)}% — above 6% threshold`,
        impact: `${fmtC(m.refundedRevenue, m.currencySymbol)} refunded this period`,
        severity: m.refundRate >= 10 ? "high" : "medium",
      });
    }

    if (m.oosRate >= 15) {
      out.push({
        store: m.storeName,
        storeCode: m.storeCode,
        risk: `${m.oosRate.toFixed(0)}% of active SKUs out of stock`,
        impact: "Significant lost revenue from unfulfilled demand",
        severity: m.oosRate >= 25 ? "high" : "medium",
      });
    }

    if (m.deadStockCount >= 30) {
      out.push({
        store: m.storeName,
        storeCode: m.storeCode,
        risk: `${m.deadStockCount} dead-stock SKUs tying up capital`,
        impact: "Capital locked in non-moving inventory",
        severity: "medium",
      });
    }

    if (m.revenueDelta !== null && m.revenueDelta <= -15) {
      out.push({
        store: m.storeName,
        storeCode: m.storeCode,
        risk: `Revenue fell ${Math.abs(m.revenueDelta)}% vs previous period`,
        impact: `Down ${fmtC(m.prevRevenue - m.revenue, m.currencySymbol)} from prior period`,
        severity: m.revenueDelta <= -25 ? "high" : "medium",
      });
    }

    if (m.criticalCount >= 5) {
      out.push({
        store: m.storeName,
        storeCode: m.storeCode,
        risk: `${m.criticalCount} critical SKUs near stockout`,
        impact: "Immediate restocking required to prevent OOS",
        severity: "high",
      });
    }
  }

  const ORDER: Record<Risk["severity"], number> = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]).slice(0, 6);
}

// ─── Weekly insights ──────────────────────────────────────────────────────────

function buildInsights(metrics: StoreMetrics[]): string[] {
  if (!metrics.length) return [];
  const ins: string[] = [];

  const sorted = [...metrics].sort((a, b) => b.performanceScore - a.performanceScore);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  ins.push(
    `${best.storeName} leads with a performance score of ${best.performanceScore}/100` +
    (best.revenueDelta !== null && best.revenueDelta > 0
      ? ` — revenue up ${best.revenueDelta}%.`
      : "."),
  );

  const mostOOS = [...metrics].sort((a, b) => b.oosRate - a.oosRate)[0];
  if (mostOOS.oosRate >= 10) {
    ins.push(
      `${mostOOS.storeName} has ${mostOOS.oosCount} out-of-stock SKUs (${mostOOS.oosRate.toFixed(0)}%) — replenishment recommended.`,
    );
  }

  const highRefund = metrics.find(m => m.refundRate >= 5);
  if (highRefund) {
    ins.push(
      `${highRefund.storeName} refund rate at ${highRefund.refundRate.toFixed(1)}% — investigate product quality or listing accuracy.`,
    );
  }

  const highDead = [...metrics].sort((a, b) => b.deadStockCount - a.deadStockCount)[0];
  if (highDead.deadStockCount >= 10) {
    ins.push(
      `${highDead.storeName} has ${highDead.deadStockCount} dead-stock SKUs — consider a targeted clearance campaign.`,
    );
  }

  for (const m of metrics) {
    const cat = m.topCategories[0];
    if (cat && cat.growth !== null && cat.growth >= 20) {
      ins.push(
        `${m.storeName}: "${cat.name}" category growing ${cat.growth}% — strong demand signal worth monitoring.`,
      );
      break;
    }
  }

  if (worst.performanceScore < 50 && worst.storeId !== best.storeId) {
    ins.push(
      `${worst.storeName} has the lowest score at ${worst.performanceScore}/100 — review ${worst.refundRate > 5 ? "refund rate" : worst.oosRate > 15 ? "OOS exposure" : "revenue trend"}.`,
    );
  }

  return ins.slice(0, 5);
}

// ─── Main hook ────────────────────────────────────────────────────────────────

export function useStorePerformance(bounds: DateBounds) {
  return useQuery<StorePerformanceData>({
    queryKey: ["store-performance", bounds.cacheKey],
    staleTime: 60_000,
    queryFn: async (): Promise<StorePerformanceData> => {
      // Extract date strings for date-type columns in views
      const startDate = bounds.startISO.slice(0, 10);
      const endDate   = bounds.endISO.slice(0, 10);
      const prevStart = bounds.prevStartISO.slice(0, 10);
      const prevEnd   = bounds.prevEndISO.slice(0, 10);

      // ── 1. Fetch all active stores ──────────────────────────────────────────
      const { data: storesRaw, error: storesErr } = await supabase
        .from("stores")
        .select("id, store_name, store_code, currency, currency_symbol, is_active")
        .eq("is_active", true);
      if (storesErr) throw storesErr;

      const stores: StoreInfo[] = (storesRaw ?? []).map((s: any) => ({
        id:              s.id,
        store_name:      s.store_name,
        store_code:      s.store_code ?? s.store_name.toLowerCase().replace(/\s+/g, "_"),
        currency:        s.currency ?? "GBP",
        currency_symbol: s.currency_symbol ?? "£",
      }));

      if (!stores.length) {
        return {
          stores: [],
          storeMetrics: [],
          globalSummary: {
            totalRevenue: 0, prevRevenue: 0, revenueDelta: null,
            totalOrders: 0, prevOrders: 0, ordersDelta: null,
            totalUnitsSold: 0, avgSellThrough: 0, avgOOSRate: 0, avgRefundRate: 0,
          },
          opportunities: [],
          risks: [],
          insights: [],
          crossStoreTrend: [],
        };
      }

      // ── 2–9. Parallel queries (no store filter — cross-store page) ──────────
      const [
        curOrdersRes,
        prevOrdersRes,
        curVelRes,
        invRes,
        deadRes,
        replenRes,
        curCollRes,
        prevCollRes,
      ] = await Promise.all([
        // [2] Current period orders
        (supabase as any)
          .from("orders")
          .select("id, store_id, total_price, financial_status, cancelled_at, shopify_created_at")
          .gte("shopify_created_at", bounds.startISO)
          .lte("shopify_created_at", bounds.endISO)
          .limit(50_000),

        // [3] Previous period orders
        (supabase as any)
          .from("orders")
          .select("store_id, total_price, cancelled_at, financial_status")
          .gte("shopify_created_at", bounds.prevStartISO)
          .lte("shopify_created_at", bounds.prevEndISO)
          .limit(50_000),

        // [4] Current period order-product revenue (units sold, daily date)
        (supabase as any)
          .from("v_order_product_revenue")
          .select("store_id, quantity, order_date, cancelled_at")
          .gte("order_date", startDate)
          .lte("order_date", endDate)
          .limit(100_000),

        // [5] Inventory summary — active products only, paginated
        (async () => {
          const PAGE = 1000;
          const all: any[] = [];
          let offset = 0;
          while (true) {
            const { data, error } = await (supabase as any)
              .from("v_product_inventory_summary")
              .select("store_id, total_inventory, product_status")
              .eq("product_status", "active")
              .range(offset, offset + PAGE - 1);
            if (error || !data?.length) break;
            all.push(...data);
            if (data.length < PAGE) break;
            offset += PAGE;
          }
          return { data: all, error: null };
        })(),

        // [6] Dead stock — paginated (1913 rows, over server cap)
        (async () => {
          const PAGE = 1000;
          const all: any[] = [];
          let offset = 0;
          while (true) {
            const { data, error } = await (supabase as any)
              .from("v_dead_stock")
              .select("store_id, dead_stock_status, total_units")
              .range(offset, offset + PAGE - 1);
            if (error || !data?.length) break;
            all.push(...data);
            if (data.length < PAGE) break;
            offset += PAGE;
          }
          return { data: all, error: null };
        })(),

        // [7] Replenishment candidates per store
        (supabase as any)
          .from("v_replenishment_candidates")
          .select("store_id, replenishment_status")
          .limit(10_000),

        // [8] Collection revenue current period
        (supabase as any)
          .from("v_collection_revenue")
          .select("store_id, collection_name, line_revenue, quantity, cancelled_at")
          .gte("order_date", startDate)
          .lte("order_date", endDate)
          .limit(50_000),

        // [9] Collection revenue previous period (for category growth %)
        (supabase as any)
          .from("v_collection_revenue")
          .select("store_id, collection_name, line_revenue, quantity, cancelled_at")
          .gte("order_date", prevStart)
          .lte("order_date", prevEnd)
          .limit(50_000),
      ]);

      // ── Process raw rows ────────────────────────────────────────────────────

      const curOrders: any[] = (curOrdersRes.data ?? []);
      const prevOrders: any[] = (prevOrdersRes.data ?? []);
      const velRows: any[] = (curVelRes.data ?? []);
      const invRows: any[] = (invRes.data ?? []);
      const deadRows: any[] = (deadRes.data ?? []);
      const replenRows: any[] = (replenRes.data ?? []);
      const curCollRows: any[] = (curCollRes.data ?? []);
      const prevCollRows: any[] = (prevCollRes.data ?? []);

      const INTERNAL = new Set(["trending now", "all", "top selling"]);
      const isInternalColl = (n: string | null | undefined) =>
        !n || INTERNAL.has((n ?? "").toLowerCase());

      // ── Group by store ──────────────────────────────────────────────────────

      interface StoreAgg {
        // current orders (non-cancelled)
        revenue: number;
        orders: number;
        refundedOrders: number;
        refundedRevenue: number;
        // prev orders (non-cancelled)
        prevRevenue: number;
        prevOrders: number;
        // units sold
        unitsSold: number;
        // daily revenue map date→revenue
        daily: Map<string, number>;
        // inventory
        activeSKUs: number;
        totalInventory: number;
        oosSKUs: number;
        // dead stock
        deadStockCount: number;
        overstockedCount: number;
        // replenishment
        lowStockCount: number;
        criticalCount: number;
        // categories current
        catRevenue: Map<string, number>;
        catUnits: Map<string, number>;
        // categories prev
        prevCatRevenue: Map<string, number>;
      }

      const agg = new Map<string, StoreAgg>();
      const ensureAgg = (sid: string): StoreAgg => {
        if (!agg.has(sid)) {
          agg.set(sid, {
            revenue: 0, orders: 0, refundedOrders: 0, refundedRevenue: 0,
            prevRevenue: 0, prevOrders: 0,
            unitsSold: 0,
            daily: new Map(),
            activeSKUs: 0, totalInventory: 0, oosSKUs: 0,
            deadStockCount: 0, overstockedCount: 0,
            lowStockCount: 0, criticalCount: 0,
            catRevenue: new Map(), catUnits: new Map(),
            prevCatRevenue: new Map(),
          });
        }
        return agg.get(sid)!;
      };

      // Current orders
      for (const r of curOrders) {
        if (!r.store_id || r.cancelled_at) continue;
        const a = ensureAgg(r.store_id);
        a.orders  += 1;
        a.revenue += Number(r.total_price ?? 0);
        if (r.financial_status === "refunded" || r.financial_status === "partially_refunded") {
          a.refundedOrders  += 1;
          a.refundedRevenue += Number(r.total_price ?? 0);
        }
      }

      // Prev orders
      for (const r of prevOrders) {
        if (!r.store_id || r.cancelled_at) continue;
        const a = ensureAgg(r.store_id);
        a.prevOrders  += 1;
        a.prevRevenue += Number(r.total_price ?? 0);
      }

      // Units sold + daily revenue from v_order_product_revenue
      for (const r of velRows) {
        if (!r.store_id || r.cancelled_at) continue;
        const a = ensureAgg(r.store_id);
        a.unitsSold += Number(r.quantity ?? 0);
        if (r.order_date) {
          const dateKey = String(r.order_date).slice(0, 10);
          a.daily.set(dateKey, (a.daily.get(dateKey) ?? 0) + Number(r.quantity ?? 0));
        }
      }

      // Inventory: active SKU count, OOS, total inventory (view already filtered to active)
      for (const r of invRows) {
        if (!r.store_id) continue;
        const a = ensureAgg(r.store_id);
        a.activeSKUs    += 1;
        a.totalInventory += Number(r.total_inventory ?? 0);
        if (Number(r.total_inventory ?? 0) === 0) a.oosSKUs += 1;
      }

      // Dead stock
      for (const r of deadRows) {
        if (!r.store_id) continue;
        const a = ensureAgg(r.store_id);
        a.deadStockCount += 1;
        if (r.dead_stock_status === "Never Sold" && Number(r.total_units ?? 0) >= 50)
          a.overstockedCount += 1;
      }

      // Replenishment candidates
      for (const r of replenRows) {
        if (!r.store_id) continue;
        const a = ensureAgg(r.store_id);
        a.lowStockCount += 1;
        if (r.replenishment_status === "Critical") a.criticalCount += 1;
      }

      // Current collection revenue
      for (const r of curCollRows) {
        if (!r.store_id || r.cancelled_at || isInternalColl(r.collection_name)) continue;
        const a = ensureAgg(r.store_id);
        const name = r.collection_name as string;
        a.catRevenue.set(name, (a.catRevenue.get(name) ?? 0) + Number(r.line_revenue ?? 0));
        a.catUnits.set(name,   (a.catUnits.get(name)   ?? 0) + Number(r.quantity     ?? 0));
      }

      // Prev collection revenue
      for (const r of prevCollRows) {
        if (!r.store_id || r.cancelled_at || isInternalColl(r.collection_name)) continue;
        const a = ensureAgg(r.store_id);
        const name = r.collection_name as string;
        a.prevCatRevenue.set(name, (a.prevCatRevenue.get(name) ?? 0) + Number(r.line_revenue ?? 0));
      }

      // ── Build daily trend points for the cross-store chart ─────────────────
      // Generate date labels for the current period (last 14 points)
      const trendDates: string[] = [];
      const msPerDay = 86_400_000;
      const start = new Date(bounds.startISO);
      const end   = new Date(bounds.endISO);
      const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / msPerDay));
      const maxPoints = Math.min(totalDays, 30);
      const step = Math.max(1, Math.floor(totalDays / maxPoints));
      for (let i = 0; i < totalDays; i += step) {
        const d = new Date(start.getTime() + i * msPerDay);
        trendDates.push(d.toISOString().slice(0, 10));
      }

      // ── Assemble StoreMetrics per store ────────────────────────────────────
      const storeMetrics: StoreMetrics[] = [];

      for (const store of stores) {
        const a = agg.get(store.id);
        if (!a) {
          // Store exists but no data yet — return zero-metrics
          const empty: StoreMetrics = {
            storeId: store.id, storeName: store.store_name,
            storeCode: store.store_code, currency: store.currency ?? "GBP",
            currencySymbol: store.currency_symbol ?? "£",
            revenue: 0, prevRevenue: 0, revenueDelta: null,
            orders: 0, prevOrders: 0, ordersDelta: null,
            unitsSold: 0, refundRate: 0, refundedRevenue: 0,
            aov: 0, sellThrough: 0, totalSKUs: 0, activeSKUs: 0,
            oosCount: 0, oosRate: 0, lowStockCount: 0, criticalCount: 0,
            deadStockCount: 0, overstockedCount: 0, inventoryHealthScore: 100,
            performanceScore: 0, prevPerformanceScore: null, scoreDelta: null, scoreBreakdown: [],
            dailyRevenue: [], topCategories: [], diagnosis: "No data available for this store.",
          };
          storeMetrics.push(empty);
          continue;
        }

        const revenueDelta    = delta(a.revenue,      a.prevRevenue);
        const ordersDelta     = delta(a.orders,        a.prevOrders);
        const refundRate      = pct(a.refundedOrders,  a.orders);
        const oosRate         = pct(a.oosSKUs,         a.activeSKUs);
        const deadStockRatio  = a.activeSKUs > 0 ? a.deadStockCount / a.activeSKUs : 0;
        const sellThrough     = a.unitsSold + a.totalInventory > 0
          ? pct(a.unitsSold, a.unitsSold + a.totalInventory)
          : 0;

        const { score: performanceScore, factors: scoreBreakdown } = computeScore({
          revenueDelta, ordersDelta, refundRate, oosRate, sellThrough, deadStockRatio,
        });

        // Prev score (uses prev-period order deltas as approximation since we don't
        // have the period before prev; use revenue delta flipped as a proxy)
        const prevPerformanceScore = a.prevRevenue > 0
          ? computeScore({
              revenueDelta: revenueDelta !== null ? -revenueDelta : null,
              ordersDelta: ordersDelta !== null ? -ordersDelta : null,
              refundRate, oosRate, sellThrough, deadStockRatio,
            }).score
          : null;

        const scoreDelta = prevPerformanceScore !== null
          ? performanceScore - prevPerformanceScore
          : null;

        const inventoryHealthScore = computeInventoryHealth(oosRate, deadStockRatio, a.criticalCount);

        // Top 3 categories by revenue
        const topCategories: CategoryStat[] = Array.from(a.catRevenue.entries())
          .sort(([, ra], [, rb]) => rb - ra)
          .slice(0, 3)
          .map(([name, revenue]) => {
            const prev    = a.prevCatRevenue.get(name) ?? 0;
            const catDelt = delta(revenue, prev);
            return {
              name,
              revenue,
              units: a.catUnits.get(name) ?? 0,
              growth: catDelt,
            };
          });

        // Daily revenue for sparkline (use unit counts as proxy since we track qty)
        const dailyRevenue = trendDates.map(d => a.daily.get(d) ?? 0);

        const m: StoreMetrics = {
          storeId:   store.id,
          storeName: store.store_name,
          storeCode: store.store_code,
          currency:  store.currency ?? "GBP",
          currencySymbol: store.currency_symbol ?? "£",
          revenue:    a.revenue,
          prevRevenue: a.prevRevenue,
          revenueDelta,
          orders:    a.orders,
          prevOrders: a.prevOrders,
          ordersDelta,
          unitsSold: a.unitsSold,
          refundRate,
          refundedRevenue: a.refundedRevenue,
          aov: a.orders > 0 ? a.revenue / a.orders : 0,
          sellThrough,
          totalSKUs:  a.activeSKUs,
          activeSKUs: a.activeSKUs,
          oosCount:   a.oosSKUs,
          oosRate,
          lowStockCount:  a.lowStockCount,
          criticalCount:  a.criticalCount,
          deadStockCount: a.deadStockCount,
          overstockedCount: a.overstockedCount,
          inventoryHealthScore,
          performanceScore,
          prevPerformanceScore,
          scoreDelta,
          scoreBreakdown,
          dailyRevenue,
          topCategories,
          diagnosis: "", // filled below after metrics are assembled
        };
        m.diagnosis = buildDiagnosis(m);
        storeMetrics.push(m);
      }

      // ── Global summary ──────────────────────────────────────────────────────
      const totalRevenue    = storeMetrics.reduce((s, m) => s + m.revenue,      0);
      const prevTotalRev    = storeMetrics.reduce((s, m) => s + m.prevRevenue,  0);
      const totalOrders     = storeMetrics.reduce((s, m) => s + m.orders,       0);
      const prevTotalOrders = storeMetrics.reduce((s, m) => s + m.prevOrders,   0);
      const totalUnitsSold  = storeMetrics.reduce((s, m) => s + m.unitsSold,    0);
      const n = storeMetrics.length || 1;

      const globalSummary: GlobalSummary = {
        totalRevenue,
        prevRevenue:    prevTotalRev,
        revenueDelta:   delta(totalRevenue,    prevTotalRev),
        totalOrders,
        prevOrders:     prevTotalOrders,
        ordersDelta:    delta(totalOrders,     prevTotalOrders),
        totalUnitsSold,
        avgSellThrough: Math.round(storeMetrics.reduce((s, m) => s + m.sellThrough, 0) / n),
        avgOOSRate:     Math.round(storeMetrics.reduce((s, m) => s + m.oosRate,     0) / n),
        avgRefundRate:  Math.round((storeMetrics.reduce((s, m) => s + m.refundRate,  0) / n) * 10) / 10,
      };

      // ── Cross-store trend chart data ────────────────────────────────────────
      const crossStoreTrend: CrossStoreTrendPoint[] = trendDates.map((dateStr, idx) => {
        const pt: CrossStoreTrendPoint = {
          date:  dateStr,
          label: new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        };
        for (const m of storeMetrics) {
          pt[m.storeCode] = m.dailyRevenue[idx] ?? 0;
        }
        return pt;
      });

      const opportunities = buildOpportunities(storeMetrics);
      const risks         = buildRisks(storeMetrics);
      const insights      = buildInsights(storeMetrics);

      return {
        stores,
        storeMetrics: storeMetrics.sort((a, b) => b.performanceScore - a.performanceScore),
        globalSummary,
        opportunities,
        risks,
        insights,
        crossStoreTrend,
      };
    },
  });
}
