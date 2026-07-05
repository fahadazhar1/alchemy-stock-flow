import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeKey, CHANNEL_META } from "./useChannelPerformance";

export interface DailyChannelStat {
  key: string;
  name: string;
  color: string;
  todayOrders: number;
  todayRevenue: number;
  yesterdayOrders: number;
  yesterdayRevenue: number;
  revenueDelta: number | null;
}

export interface DailyStorePulse {
  storeId: string;
  storeName: string;
  storeCode: string;
  currency: string;
  currencySymbol: string;
  todayRevenue: number;
  todayOrders: number;
  yesterdayRevenue: number;
  yesterdayOrders: number;
  revenueDelta: number | null;
  ordersDelta: number | null;
  channels: DailyChannelStat[]; // every channel with activity, sorted by today's revenue desc
}

function delta(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

interface ChannelAgg {
  today:     { orders: number; revenue: number };
  yesterday: { orders: number; revenue: number };
}

export function useDailySalesPulse() {
  return useQuery<DailyStorePulse[]>({
    queryKey: ["daily-sales-pulse"],
    staleTime: 3 * 60_000,
    refetchInterval: 3 * 60_000,
    queryFn: async (): Promise<DailyStorePulse[]> => {
      const [{ data: storesRaw, error: storesErr }, { data, error }] = await Promise.all([
        supabase
          .from("stores")
          .select("id, store_name, store_code, currency, currency_symbol, is_active")
          .eq("is_active", true),
        (supabase as any).rpc("get_store_daily_channel_sales"),
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
          channels.set(key, {
            today:     { orders: 0, revenue: 0 },
            yesterday: { orders: 0, revenue: 0 },
          });
        }
        const c = channels.get(key)!;
        const netRevenue = Number(r.revenue ?? 0) - Number(r.refunded_revenue ?? 0);
        const bucket = r.bucket === "today" ? c.today : c.yesterday;
        bucket.orders  += Number(r.orders ?? 0);
        bucket.revenue += netRevenue;
      }

      return (storesRaw ?? []).map((s: any): DailyStorePulse => {
        const channelMap = agg.get(s.id);
        const channels: DailyChannelStat[] = channelMap
          ? Array.from(channelMap.entries())
              .map(([key, v]) => {
                const meta = CHANNEL_META[key] ?? CHANNEL_META.unknown;
                return {
                  key,
                  name:             meta.name,
                  color:            meta.color,
                  todayOrders:      v.today.orders,
                  todayRevenue:     v.today.revenue,
                  yesterdayOrders:  v.yesterday.orders,
                  yesterdayRevenue: v.yesterday.revenue,
                  revenueDelta:     delta(v.today.revenue, v.yesterday.revenue),
                };
              })
              .filter(c => c.todayOrders > 0 || c.yesterdayOrders > 0)
              .sort((a, b) => b.todayRevenue - a.todayRevenue)
          : [];

        const todayRevenue     = channels.reduce((sum, c) => sum + c.todayRevenue, 0);
        const todayOrders      = channels.reduce((sum, c) => sum + c.todayOrders, 0);
        const yesterdayRevenue = channels.reduce((sum, c) => sum + c.yesterdayRevenue, 0);
        const yesterdayOrders  = channels.reduce((sum, c) => sum + c.yesterdayOrders, 0);

        return {
          storeId:         s.id,
          storeName:       s.store_name,
          storeCode:       s.store_code ?? s.store_name.toLowerCase().replace(/\s+/g, "_"),
          currency:        s.currency ?? "GBP",
          currencySymbol:  s.currency_symbol ?? "£",
          todayRevenue,
          todayOrders,
          yesterdayRevenue,
          yesterdayOrders,
          revenueDelta: delta(todayRevenue, yesterdayRevenue),
          ordersDelta:  delta(todayOrders, yesterdayOrders),
          channels,
        };
      });
    },
  });
}
