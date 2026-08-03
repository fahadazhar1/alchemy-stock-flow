import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeKey, CHANNEL_META } from "./useChannelPerformance";
import type { DateBounds } from "@/lib/dateRanges";

export interface ChannelSalesStat {
  key: string;
  name: string;
  color: string;
  orders: number;
  revenue: number;      // net, current period
  prevOrders: number;
  prevRevenue: number;  // net, previous period
  revenueDelta: number | null;
}

export interface StoreSalesPulse {
  storeId: string;
  storeName: string;
  storeCode: string;
  currency: string;
  currencySymbol: string;
  revenue: number;
  orders: number;
  prevRevenue: number;
  prevOrders: number;
  revenueDelta: number | null;
  ordersDelta: number | null;
  channels: ChannelSalesStat[]; // every channel with activity, sorted by revenue desc
}

function delta(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

interface ChannelAgg {
  cur:  { orders: number; revenue: number };
  prev: { orders: number; revenue: number };
}

export function useStoreSalesPulse(bounds: DateBounds, excludeShipping: boolean = false) {
  return useQuery<StoreSalesPulse[]>({
    queryKey: ["store-sales-pulse", bounds.cacheKey, excludeShipping],
    staleTime: 3 * 60_000,
    refetchInterval: 3 * 60_000,
    queryFn: async (): Promise<StoreSalesPulse[]> => {
      const [{ data: storesRaw, error: storesErr }, { data, error }] = await Promise.all([
        supabase
          .from("stores")
          .select("id, store_name, store_code, currency, currency_symbol, is_active")
          .eq("is_active", true),
        (supabase as any).rpc("get_store_period_channel_sales", {
          p_start_iso:      bounds.startISO,
          p_end_iso:        bounds.endISO,
          p_prev_start_iso: bounds.prevStartISO,
          p_prev_end_iso:   bounds.prevEndISO,
        }),
      ]);
      if (storesErr) throw storesErr;
      if (error) throw error;

      const agg = new Map<string, Map<string, ChannelAgg>>();
      const ensureChannels = (sid: string) => {
        if (!agg.has(sid)) agg.set(sid, new Map());
        return agg.get(sid)!;
      };

      for (const r of (data ?? []) as any[]) {
        if (!r.store_id) continue;
        const channels = ensureChannels(r.store_id);
        const key = normalizeKey(r.source_name);
        if (!channels.has(key)) {
          channels.set(key, { cur: { orders: 0, revenue: 0 }, prev: { orders: 0, revenue: 0 } });
        }
        const c = channels.get(key)!;
        let netRevenue = Number(r.revenue ?? 0) - Number(r.refunded_revenue ?? 0);
        if (excludeShipping) netRevenue -= Number(r.shipping_revenue ?? 0);
        const bucket = r.bucket === "cur" ? c.cur : c.prev;
        bucket.orders  += Number(r.orders ?? 0);
        bucket.revenue += netRevenue;
      }

      return (storesRaw ?? []).map((s: any): StoreSalesPulse => {
        const channelMap = agg.get(s.id);
        const channels: ChannelSalesStat[] = channelMap
          ? Array.from(channelMap.entries())
              .map(([key, v]) => {
                const meta = CHANNEL_META[key] ?? CHANNEL_META.unknown;
                return {
                  key,
                  name:         meta.name,
                  color:        meta.color,
                  orders:       v.cur.orders,
                  revenue:      v.cur.revenue,
                  prevOrders:   v.prev.orders,
                  prevRevenue:  v.prev.revenue,
                  revenueDelta: delta(v.cur.revenue, v.prev.revenue),
                };
              })
              .filter(c => c.orders > 0 || c.prevOrders > 0)
              .sort((a, b) => b.revenue - a.revenue)
          : [];

        const revenue     = channels.reduce((sum, c) => sum + c.revenue, 0);
        const orders      = channels.reduce((sum, c) => sum + c.orders, 0);
        const prevRevenue = channels.reduce((sum, c) => sum + c.prevRevenue, 0);
        const prevOrders  = channels.reduce((sum, c) => sum + c.prevOrders, 0);

        return {
          storeId:        s.id,
          storeName:      s.store_name,
          storeCode:      s.store_code ?? s.store_name.toLowerCase().replace(/\s+/g, "_"),
          currency:       s.currency ?? "GBP",
          currencySymbol: s.currency_symbol ?? "£",
          revenue,
          orders,
          prevRevenue,
          prevOrders,
          revenueDelta: delta(revenue, prevRevenue),
          ordersDelta:  delta(orders, prevOrders),
          channels,
        };
      });
    },
  });
}
