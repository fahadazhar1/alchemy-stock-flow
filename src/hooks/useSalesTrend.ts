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
    queryKey: ["sales-trend", storeId, b.startISO, b.prevStartISO],
    queryFn: async (): Promise<TrendPoint[]> => {
      // Fetch current + prev period in parallel
      let curQ = (supabase as any)
        .from("orders")
        .select("shopify_created_at, total_price, id")
        .gte("shopify_created_at", b.startISO)
        .lte("shopify_created_at", b.endISO)
        .is("cancelled_at", null);

      let prevQ = (supabase as any)
        .from("orders")
        .select("shopify_created_at, total_price, id")
        .gte("shopify_created_at", b.prevStartISO)
        .lte("shopify_created_at", b.prevEndISO)
        .is("cancelled_at", null);

      if (storeId) { curQ = curQ.eq("store_id", storeId); prevQ = prevQ.eq("store_id", storeId); }

      const [curRes, prevRes] = await Promise.all([curQ, prevQ]);
      if (curRes.error) throw curRes.error;

      // Build day-offset buckets for both periods
      // Key = day index from period start (0, 1, 2...) so they align on X axis
      const curStart  = new Date(b.startISO);  curStart.setHours(0, 0, 0, 0);
      const prevStart = new Date(b.prevStartISO); prevStart.setHours(0, 0, 0, 0);
      const DAY = 86_400_000;

      const bucket = (rows: any[], periodStart: Date) => {
        const map = new Map<number, { revenue: number; orders: number }>();
        for (const row of rows ?? []) {
          if (!row.shopify_created_at) continue;
          const d = new Date((row.shopify_created_at as string).slice(0, 10));
          const idx = Math.round((d.getTime() - periodStart.getTime()) / DAY);
          const e = map.get(idx) ?? { revenue: 0, orders: 0 };
          e.revenue += Number(row.total_price ?? 0);
          e.orders  += 1;
          map.set(idx, e);
        }
        return map;
      };

      const curMap  = bucket(curRes.data,  curStart);
      const prevMap = bucket(prevRes.data ?? [], prevStart);

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