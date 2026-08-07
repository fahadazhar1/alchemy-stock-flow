import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// GA4 data is synced daily (ga4-sync edge function, 03:00 UTC cron) into
// ga4_daily_metrics / ga4_channel_daily — these hooks just read the
// pre-aggregated RPCs. GA4's `date` is already a calendar date in each
// property's own reporting timezone, so plain yyyy-MM-dd month bounds line
// up correctly — no KSA UTC-shift needed here, unlike the orders-table RPCs.

export interface Ga4StoreSummary {
  storeId: string;
  sessions: number;
  avgBounceRate: number; // fraction 0-1
  conversions: number;
  hasSynced: boolean;
}

export function useGa4MonthlySummary(startDate: string, endDate: string) {
  return useQuery<Ga4StoreSummary[]>({
    queryKey: ["ga4-monthly-summary", startDate, endDate],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_ga4_monthly_summary" as any, {
        p_start_date: startDate,
        p_end_date: endDate,
      } as any);
      if (error) throw error;
      return ((data ?? []) as any[]).map(r => ({
        storeId: r.store_id,
        sessions: Number(r.sessions),
        avgBounceRate: Number(r.avg_bounce_rate),
        conversions: Number(r.conversions),
        hasSynced: Boolean(r.has_synced),
      }));
    },
  });
}

export interface Ga4ChannelRow {
  storeId: string;
  channelGroup: string;
  sessions: number;
}

export function useGa4ChannelSummary(startDate: string, endDate: string) {
  return useQuery<Ga4ChannelRow[]>({
    queryKey: ["ga4-channel-summary", startDate, endDate],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_ga4_channel_summary" as any, {
        p_start_date: startDate,
        p_end_date: endDate,
      } as any);
      if (error) throw error;
      return ((data ?? []) as any[]).map(r => ({
        storeId: r.store_id,
        channelGroup: r.channel_group,
        sessions: Number(r.sessions),
      }));
    },
  });
}
