import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStoreFilter } from "./useStoreFilter";
import type { DateBounds } from "@/lib/dateRanges";
import { getDateBounds } from "@/lib/dateRanges";

export interface TrendPoint {
  date: Date;
  label: string;
  revenue: number;
  orders: number;
  prevRevenue: number;
  prevOrders: number;
  projected?: number;
  isProjected?: boolean;
}

export function useSalesTrend(days = 30, bounds?: DateBounds) {
  const { storeId } = useStoreFilter();
  const b = bounds ?? (() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return {
      startISO: cutoff.toISOString(),
      endISO: new Date().toISOString(),
      prevStartISO: new Date(cutoff.getTime() - days * 86_400_000).toISOString(),
      prevEndISO: cutoff.toISOString(),
    } as DateBounds;
  })();

  return useQuery({
    queryKey: ["sales-trend", storeId, b.cacheKey],
    queryFn: async (): Promise<TrendPoint[]> => {
      // Server-side daily rollup — see migration 20260615000001_sales_trend_rpc.sql.
      // Returns ~30-120 daily rows instead of up to 20k raw order rows.
      const { data, error } = await (supabase as any).rpc("get_sales_trend", {
        p_start_iso:      b.startISO,
        p_end_iso:        b.endISO,
        p_prev_start_iso: b.prevStartISO,
        p_prev_end_iso:   b.prevEndISO,
        p_store_id:       storeId ?? null,
      });
      if (error) throw error;

      // Build day-offset buckets for both periods
      // Key = day index from period start (0, 1, 2...) so they align on X axis
      const curStart  = new Date(b.startISO);  curStart.setHours(0, 0, 0, 0);
      const prevStart = new Date(b.prevStartISO); prevStart.setHours(0, 0, 0, 0);
      const DAY = 86_400_000;

      // bucket_date is "YYYY-MM-DD" → new Date() parses as UTC midnight, identical
      // to the old new Date(shopify_created_at.slice(0,10)) bucketing.
      const fill = (period: "cur" | "prev", periodStart: Date) => {
        const map = new Map<number, { revenue: number; orders: number }>();
        for (const row of (data ?? []) as any[]) {
          if (row.period !== period || !row.bucket_date) continue;
          const d = new Date(row.bucket_date as string);
          const idx = Math.round((d.getTime() - periodStart.getTime()) / DAY);
          map.set(idx, { revenue: Number(row.revenue ?? 0), orders: Number(row.orders ?? 0) });
        }
        return map;
      };

      const curMap  = fill("cur",  curStart);
      const prevMap = fill("prev", prevStart);

      const end = new Date();
      const totalDays = Math.ceil((end.getTime() - curStart.getTime()) / DAY) + 1;
      const result: TrendPoint[] = [];

      for (let i = 0; i < totalDays; i++) {
        const d = new Date(curStart.getTime() + i * DAY);
        const cur  = curMap.get(i)  ?? { revenue: 0, orders: 0 };
        const prev = prevMap.get(i) ?? { revenue: 0, orders: 0 };
        result.push({
          date:        d,
          label:       d.toLocaleDateString("en-GB", { month: "short", day: "numeric" }),
          revenue:     cur.revenue,
          orders:      cur.orders,
          prevRevenue: prev.revenue,
          prevOrders:  prev.orders,
        });
      }

      return result;
    },
  });
}