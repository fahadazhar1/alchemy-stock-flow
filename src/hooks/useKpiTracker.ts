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

export function useDailyKpiEntriesHistory() {
  return useQuery<DailyKpiEntry[]>({
    queryKey: ["daily-kpi-entries-history", HISTORY_DAYS],
    staleTime: 60_000,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await (supabase as any)
        .from("daily_kpi_entries")
        .select("*")
        .gte("entry_date", cutoff)
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
