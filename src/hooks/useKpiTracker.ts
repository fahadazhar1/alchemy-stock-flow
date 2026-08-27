import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface KpiMetricConfig {
  id: string;
  store_id: string;
  metric_key: string;
  metric_label: string;
  owner: string;
  target: string;
  is_auto: boolean;
  sort_order: number;
}

export interface DailyKpiEntry {
  id: string;
  store_id: string;
  entry_date: string;
  metric_key: string;
  value_text: string;
}

export function useKpiConfig() {
  return useQuery<KpiMetricConfig[]>({
    queryKey: ["kpi-metric-config"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("kpi_metric_config")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useDailyKpiEntries(date: string) {
  return useQuery<DailyKpiEntry[]>({
    queryKey: ["daily-kpi-entries", date],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("daily_kpi_entries")
        .select("*")
        .eq("entry_date", date);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUpsertKpiEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { store_id: string; entry_date: string; metric_key: string; value_text: string }) => {
      const { error } = await (supabase as any)
        .from("daily_kpi_entries")
        .upsert(input, { onConflict: "store_id,entry_date,metric_key" });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["daily-kpi-entries", vars.entry_date] });
    },
  });
}

export function useDeleteKpiEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { store_id: string; entry_date: string; metric_key: string }) => {
      const { error } = await (supabase as any)
        .from("daily_kpi_entries")
        .delete()
        .eq("store_id", input.store_id)
        .eq("entry_date", input.entry_date)
        .eq("metric_key", input.metric_key);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["daily-kpi-entries", vars.entry_date] });
      queryClient.invalidateQueries({ queryKey: ["daily-kpi-entries-range"] });
    },
  });
}

export function useUpdateKpiConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; owner?: string; target?: string }) => {
      const { id, ...patch } = input;
      const { error } = await (supabase as any)
        .from("kpi_metric_config")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["kpi-metric-config"] }),
  });
}

export interface ShopifySessionRow { storeId: string; date: string; sessions: number; bounces: number; conversions: number; bounceRate: number; conversionRate: number }

// Wider than the 15-day History table window — needs to cover the page's
// date-range filter bar (up to QTD, ~92 days) so "Bounce rate and CRO"
// actually changes when the filter changes, not just the last 15 days.
const SESSIONS_FETCH_DAYS = 95;

/** Shopify's own first-party session/bounce-rate analytics (ShopifyQL) — the
 * KPI Tracker's bounce-rate source. GA4's bounceRate was found corrupted by a
 * broken Web Pixel sandbox tag; this table is synced independently via
 * shopify-sessions-sync and unaffected by that issue. */
export function useShopifySessions() {
  return useQuery<ShopifySessionRow[]>({
    queryKey: ["shopify-sessions-daily", SESSIONS_FETCH_DAYS],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - SESSIONS_FETCH_DAYS * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await (supabase as any)
        .from("shopify_sessions_daily")
        .select("store_id, date, sessions, bounces, conversions, bounce_rate, conversion_rate")
        .gte("date", cutoff);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        storeId: r.store_id, date: r.date, sessions: Number(r.sessions), bounces: Number(r.bounces),
        conversions: Number(r.conversions), bounceRate: Number(r.bounce_rate), conversionRate: Number(r.conversion_rate),
      }));
    },
  });
}

export interface KpiSalesHistoryRow { storeId: string; day: string; revenue: number; orders: number }
export interface Ga4DailyHistoryRow { storeId: string; day: string; sessions: number; bounceRate: number; conversions: number; organicSessions: number }

const HISTORY_DAYS = 15;

export function useKpiSalesHistory() {
  return useQuery<KpiSalesHistoryRow[]>({
    queryKey: ["kpi-sales-history", HISTORY_DAYS],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_kpi_daily_sales_history", { p_days: HISTORY_DAYS });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        storeId: r.store_id, day: r.day, revenue: Number(r.revenue), orders: Number(r.orders),
      }));
    },
  });
}

export function useKpiGa4History() {
  return useQuery<Ga4DailyHistoryRow[]>({
    queryKey: ["kpi-ga4-history", HISTORY_DAYS],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
      const [{ data: daily, error: dailyErr }, { data: channel, error: channelErr }] = await Promise.all([
        (supabase as any).from("ga4_daily_metrics").select("store_id, date, sessions, bounce_rate, conversions").gte("date", cutoff),
        (supabase as any).from("ga4_channel_daily").select("store_id, date, channel_group, sessions").gte("date", cutoff).eq("channel_group", "Organic Search"),
      ]);
      if (dailyErr) throw dailyErr;
      if (channelErr) throw channelErr;

      const organicMap = new Map<string, number>();
      for (const r of channel ?? []) organicMap.set(`${r.store_id}|${r.date}`, Number(r.sessions));

      return (daily ?? []).map((r: any) => ({
        storeId: r.store_id,
        day: r.date,
        sessions: Number(r.sessions),
        bounceRate: Number(r.bounce_rate),
        conversions: Number(r.conversions),
        organicSessions: organicMap.get(`${r.store_id}|${r.date}`) ?? 0,
      }));
    },
  });
}

/** Generic date-range fetch for daily_kpi_entries — used for both the fixed
 * 15-day History table and the MTD column (whose start date moves with the
 * selected month). */
export function useDailyKpiEntriesRange(fromDate: string, toDate: string) {
  return useQuery<DailyKpiEntry[]>({
    queryKey: ["daily-kpi-entries-range", fromDate, toDate],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("daily_kpi_entries")
        .select("*")
        .gte("entry_date", fromDate)
        .lte("entry_date", toDate)
        .order("entry_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSendKpiReport() {
  return useMutation({
    mutationFn: async (date: string) => {
      const { data, error } = await supabase.functions.invoke("send-kpi-report", { body: { date } });
      if (error) throw error;
      return data;
    },
  });
}
