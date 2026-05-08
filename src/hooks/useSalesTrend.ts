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
}

export function useSalesTrend(days = 30, bounds?: DateBounds) {
  const { storeId } = useStoreFilter();
  const b = bounds ?? (() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return { startISO: cutoff.toISOString(), endISO: new Date().toISOString() } as DateBounds;
  })();

  return useQuery({
    queryKey: ["sales-trend", storeId, b.startISO],
    queryFn: async (): Promise<TrendPoint[]> => {
      // Use orders table directly (total_price per order, shopify_created_at for date)
      let q = (supabase as any)
        .from("orders")
        .select("shopify_created_at, total_price, id")
        .gte("shopify_created_at", b.startISO)
        .lte("shopify_created_at", b.endISO)
        .is("cancelled_at", null);

      if (storeId) q = q.eq("store_id", storeId);

      const { data, error } = await q;
      if (error) throw error;

      // Build daily buckets keyed by YYYY-MM-DD
      const byDay = new Map<string, { revenue: number; orders: number }>();
      for (const row of (data ?? []) as any[]) {
        if (!row.shopify_created_at) continue;
        const key = (row.shopify_created_at as string).slice(0, 10);
        const e = byDay.get(key) ?? { revenue: 0, orders: 0 };
        e.revenue += Number(row.total_price ?? 0);
        e.orders  += 1;
        byDay.set(key, e);
      }

      // Fill every calendar day from start to now
      const start = new Date(b.startISO);
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      const result: TrendPoint[] = [];

      for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key   = d.toISOString().slice(0, 10);
        const entry = byDay.get(key) ?? { revenue: 0, orders: 0 };
        result.push({
          date:    new Date(d),
          label:   d.toLocaleDateString("en-GB", { month: "short", day: "numeric" }),
          revenue: entry.revenue,
          orders:  entry.orders,
        });
      }

      return result;
    },
  });
}
