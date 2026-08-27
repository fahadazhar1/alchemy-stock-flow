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

export function useSendKpiReport() {
  return useMutation({
    mutationFn: async (date: string) => {
      const { data, error } = await supabase.functions.invoke("send-kpi-report", { body: { date } });
      if (error) throw error;
      return data;
    },
  });
}
