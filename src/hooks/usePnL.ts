import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { tzMidnight, tzEndOfDay, utcNoon, type DateBounds } from "@/lib/dateRanges";

// SAR and AED are both fixed USD pegs — no lookup needed, ever.
const USD_TO_SAR = 3.75;
const USD_TO_AED = 3.6725;
const AED_TO_SAR = USD_TO_SAR / USD_TO_AED; // ~1.0211

/** Full-calendar-month bounds (not rolling MTD), in the given timezone — Asia/Karachi
 *  matches what get_store_period_channel_sales expects (it shifts KSA internally). */
export function getMonthBounds(year: number, month: number, timezone = "Asia/Karachi"): DateBounds {
  const start = tzMidnight(utcNoon(year, month, 1), timezone);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = tzEndOfDay(utcNoon(year, month, lastDay), timezone);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevStart = tzMidnight(utcNoon(prevYear, prevMonth, 1), timezone);
  const prevLastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  const prevEnd = tzEndOfDay(utcNoon(prevYear, prevMonth, prevLastDay), timezone);
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    days: lastDay,
    label: monthKey,
    prevStartISO: prevStart.toISOString(),
    prevEndISO: prevEnd.toISOString(),
    cacheKey: `Month|${monthKey}`,
  };
}

export function monthKeyToDate(monthKey: string) {
  return `${monthKey}-01`;
}

export const COST_CATEGORIES = [
  { value: "ad_spend", label: "Ad Spend" },
  { value: "shopify", label: "Shopify" },
  { value: "marketplace_fee", label: "Marketplace Fee" },
  { value: "other", label: "Other" },
] as const;

export const AD_PLATFORMS = [
  { value: "google", label: "Google Ads" },
  { value: "meta", label: "Meta Ads" },
  { value: "tiktok", label: "TikTok Ads" },
  { value: "shopify", label: "Shopify" },
  { value: "other", label: "Other" },
] as const;

export const MARKETPLACE_PLATFORMS = [
  { value: "amazon", label: "Amazon" },
  { value: "ebay", label: "eBay" },
  { value: "tiktok", label: "TikTok Shop" },
  { value: "other", label: "Other" },
] as const;

export const SHOPIFY_PLATFORMS = [
  { value: "plan", label: "Shopify Plan" },
  { value: "apps", label: "Shopify Apps" },
  { value: "other", label: "Other" },
] as const;

export function platformOptionsFor(category: string) {
  if (category === "ad_spend") return AD_PLATFORMS;
  if (category === "marketplace_fee") return MARKETPLACE_PLATFORMS;
  if (category === "shopify") return SHOPIFY_PLATFORMS;
  return [] as const;
}

export interface CostEntry {
  id: string;
  store_id: string;
  category: "ad_spend" | "shopify" | "marketplace_fee" | "other";
  platform: "google" | "meta" | "tiktok" | "shopify" | "amazon" | "ebay" | "plan" | "apps" | "other" | null;
  month: string; // yyyy-mm-dd, first of month
  amount: number;
  currency: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function useAllCostEntries(monthKey: string) {
  return useQuery<CostEntry[]>({
    queryKey: ["cost-entries-all", monthKey],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cost_entries")
        .select("*")
        .eq("month", monthKeyToDate(monthKey))
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CostEntry[];
    },
  });
}

export interface CostEntryInput {
  store_id: string;
  category: CostEntry["category"];
  platform?: CostEntry["platform"];
  month: string; // "yyyy-MM"
  amount: number;
  currency: string;
  notes?: string;
}

export function useCostEntryMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["cost-entries-all"] });

  const create = useMutation({
    mutationFn: async (input: CostEntryInput) => {
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await (supabase as any).from("cost_entries").insert({
        store_id: input.store_id,
        category: input.category,
        platform: input.platform ?? null,
        month: monthKeyToDate(input.month),
        amount: input.amount,
        currency: input.currency,
        notes: input.notes ?? null,
        created_by: userData.user?.id ?? null,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, ...patch }: Partial<CostEntryInput> & { id: string }) => {
      const { data: userData } = await supabase.auth.getUser();
      const payload: Record<string, unknown> = { ...patch, updated_by: userData.user?.id ?? null, updated_at: new Date().toISOString() };
      if (patch.month) payload.month = monthKeyToDate(patch.month);
      const { data, error } = await (supabase as any).from("cost_entries").update(payload).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cost_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { create, update, remove };
}

/** GBP and PKR float, so they need a monthly rate on record. SAR/AED never do. */
export function useFxRates(monthKey: string) {
  return useQuery<Record<string, number>>({
    queryKey: ["fx-rates", monthKey],
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fx_rates")
        .select("currency, rate_to_sar")
        .eq("month", monthKeyToDate(monthKey));
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const row of (data ?? []) as any[]) map[row.currency] = Number(row.rate_to_sar);
      return map;
    },
  });
}

/** Auto-fetches + locks GBP/PKR rates for a month via the fetch-fx-rate edge function.
 *  Idempotent server-side (never overwrites an existing rate), so calling this on every
 *  page load is safe and cheap — the function does one fast DB read once rates exist. */
export function useEnsureFxRates(monthKey: string) {
  return useQuery<{ rates: Record<string, number>; fetched: boolean }>({
    queryKey: ["ensure-fx-rates", monthKey],
    staleTime: 60 * 60_000,
    retry: 2,
    refetchOnMount: "always", // never trust a stale/empty result from before a fix — always re-check
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("fetch-fx-rate", { body: { monthKey } });
      if (error) {
        console.error("fetch-fx-rate failed:", error);
        throw error;
      }
      return data;
    },
  });
}

export function useUpsertFxRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ currency, monthKey, rate }: { currency: string; monthKey: string; rate: number }) => {
      const { data, error } = await (supabase as any)
        .from("fx_rates")
        .upsert({ currency, month: monthKeyToDate(monthKey), rate_to_sar: rate }, { onConflict: "currency,month" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fx-rates"] });
      queryClient.invalidateQueries({ queryKey: ["ensure-fx-rates"] });
    },
  });
}

/** Converts a native-currency amount to SAR. Returns null if a floating currency's
 *  rate for that month hasn't been entered yet — callers should show "rate missing"
 *  rather than silently treating it as zero. */
export function currencyToSar(amount: number, currency: string, fxRates: Record<string, number>): number | null {
  if (currency === "SAR") return amount;
  if (currency === "AED") return amount * AED_TO_SAR;
  const rate = fxRates[currency];
  return rate ? amount * rate : null;
}

// ─── Sales bridge (Gross -> Discounts -> Net) ──────────────────────────────
// Gross Sales is DERIVED as net_sales + discounts (not summed independently)
// so it always reconciles exactly to the same Net Sales figure shown
// everywhere else on the page. Returns is not included — the orders table has
// no refund/return field synced (see the migration comment); only the
// standalone monthly PDF report scripts have that, pulled live from Shopify.
export interface SalesBridgeRow { storeId: string; netSales: number; discounts: number; grossSales: number; orderCount: number }

export function useSalesBridge(bounds: DateBounds) {
  return useQuery<SalesBridgeRow[]>({
    queryKey: ["sales-bridge", bounds.cacheKey],
    staleTime: 3 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_store_sales_bridge" as any, {
        p_start_iso: bounds.startISO,
        p_end_iso: bounds.endISO,
      } as any);
      if (error) throw error;
      return ((data ?? []) as any[]).map(r => ({
        storeId: r.store_id,
        netSales: Number(r.net_sales),
        discounts: Number(r.discounts),
        grossSales: Number(r.net_sales) + Number(r.discounts),
        orderCount: Number(r.order_count),
      }));
    },
  });
}

// ─── Traffic source (paid / organic / direct) ──────────────────────────────
// Classifies each online-store order using its landing_site query string.
// "Paid" requires an actual ad-click ID (gclid/fbclid/ttclid/gbraid/wbraid)
// — NOT just utm_source=google, since Shopify's free Google Shopping
// listing sync also stamps utm_source=google on completely free traffic
// (confirmed on real order data before this was built).

export interface TrafficSourceRow { storeId: string; source: "paid" | "organic" | "direct"; orders: number; revenue: number }

export function useTrafficSource(bounds: DateBounds) {
  return useQuery<TrafficSourceRow[]>({
    queryKey: ["traffic-source", bounds.cacheKey],
    staleTime: 3 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_store_traffic_source" as any, {
        p_start_iso: bounds.startISO,
        p_end_iso: bounds.endISO,
      } as any);
      if (error) throw error;
      return ((data ?? []) as any[]).map(r => ({
        storeId: r.store_id,
        source: r.source,
        orders: Number(r.orders),
        revenue: Number(r.revenue),
      }));
    },
  });
}

// ─── Discount tiers ─────────────────────────────────────────────────────────
// Per-order discount % excludes shipping from both sides of the ratio (see
// migration comment) — mirrors the store's old Excel P&L tracker's "Sales
// by Discount Tier" table. tier: 0 = No Discount, 5..30 = that tier exactly,
// 35 = "35%+". Fetched lazily (only when the card is expanded).

export interface DiscountTierRow { storeId: string; tier: number; orders: number; revenue: number }

export function useDiscountTiers(bounds: DateBounds, enabled: boolean) {
  return useQuery<DiscountTierRow[]>({
    queryKey: ["discount-tiers", bounds.cacheKey],
    staleTime: 5 * 60_000,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_store_discount_tiers" as any, {
        p_start_iso: bounds.startISO,
        p_end_iso: bounds.endISO,
      } as any);
      if (error) throw error;
      return ((data ?? []) as any[]).map(r => ({
        storeId: r.store_id,
        tier: Number(r.tier),
        orders: Number(r.orders),
        revenue: Number(r.revenue),
      }));
    },
  });
}

// ─── Monthly Net Sales trend ────────────────────────────────────────────────

export interface MonthlyTrendPoint { storeId: string; monthStart: string; netSales: number; orderCount: number }

export function useMonthlyNetSalesTrend(startISO: string, endISO: string) {
  return useQuery<MonthlyTrendPoint[]>({
    queryKey: ["monthly-net-sales-trend", startISO, endISO],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_monthly_net_sales_trend" as any, {
        p_start_iso: startISO,
        p_end_iso: endISO,
      } as any);
      if (error) throw error;
      return ((data ?? []) as any[]).map(r => ({
        storeId: r.store_id,
        monthStart: r.month_start,
        netSales: Number(r.net_sales),
        orderCount: Number(r.order_count),
      }));
    },
  });
}

// ─── Cart abandonment ───────────────────────────────────────────────────────
// abandoned_checkouts is already synced live from Shopify every 15 min
// (shopify-sync edge function) — this just aggregates it per store/period.

export interface AbandonmentRow {
  storeId: string;
  abandonedCount: number;
  revenueAtRisk: number;
  completedOnlineOrders: number;
  hasSynced: boolean;
}

export function useCheckoutAbandonment(bounds: DateBounds) {
  return useQuery<AbandonmentRow[]>({
    queryKey: ["checkout-abandonment-pnl", bounds.cacheKey],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_store_checkout_abandonment" as any, {
        p_start_iso: bounds.startISO,
        p_end_iso: bounds.endISO,
      } as any);
      if (error) throw error;
      return ((data ?? []) as any[]).map(r => ({
        storeId: r.store_id,
        abandonedCount: Number(r.abandoned_count),
        revenueAtRisk: Number(r.revenue_at_risk),
        completedOnlineOrders: Number(r.completed_online_orders),
        hasSynced: Boolean(r.has_synced),
      }));
    },
  });
}
