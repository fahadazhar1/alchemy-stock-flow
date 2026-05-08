import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStoreFilter } from "./useStoreFilter";
import type { DateBounds } from "@/lib/dateRanges";
import { getDateBounds } from "@/lib/dateRanges";

export interface ChannelStat {
  key: string;
  name: string;
  revenue: number;
  orders: number;
  aov: number;
  share: number;
  color: string;
  dailyRevenue: number[];
}

const CHANNEL_META: Record<string, { name: string; color: string }> = {
  web:                  { name: "Online Store",  color: "#5E5CE6" },
  pos:                  { name: "Point of Sale", color: "#10B981" },
  shop:                 { name: "Shop App",      color: "#EC4899" },
  shopify_draft_orders: { name: "Draft Orders",  color: "#F59E0B" },
  wholesale:            { name: "Wholesale",     color: "#3B82F6" },
  exchange:             { name: "Exchange",      color: "#6B7280" },
  subscription:         { name: "Subscription",  color: "#8B5CF6" },
  unknown:              { name: "Other",         color: "#9CA3AF" },
};

function normalizeKey(source: string | null): string {
  const k = (source ?? "unknown").toLowerCase();
  if (k === "" || k === "null") return "web"; // Shopify web orders often have null source
  if (k === "android" || k === "iphone") return "shop";
  return CHANNEL_META[k] ? k : "unknown";
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function useChannelPerformance(days = 30, bounds?: DateBounds) {
  const { storeId } = useStoreFilter();
  const b = bounds ?? getDateBounds("MTD");

  return useQuery({
    queryKey: ["channel-performance", storeId, b.startISO],
    queryFn: async (): Promise<ChannelStat[]> => {
      // Use shopify_created_at — the actual order date, not DB insert time
      let q = (supabase as any)
        .from("orders")
        .select("source_name, total_price, shopify_created_at")
        .gte("shopify_created_at", b.startISO)
        .lte("shopify_created_at", b.endISO)
        .is("cancelled_at", null);

      if (storeId) q = q.eq("store_id", storeId);

      const { data, error } = await q;
      if (error) throw error;

      // Build last-14-day keys for sparkline
      const last14: string[] = Array.from({ length: 14 }, (_, i) => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - (13 - i));
        return toDateKey(d);
      });

      type Entry = { revenue: number; orders: number; dailyMap: Map<string, number> };
      const map = new Map<string, Entry>();

      for (const row of (data ?? []) as any[]) {
        const key = normalizeKey(row.source_name);
        if (!map.has(key)) map.set(key, { revenue: 0, orders: 0, dailyMap: new Map() });
        const entry = map.get(key)!;
        const price = Number(row.total_price) || 0;
        entry.revenue += price;
        entry.orders  += 1;
        if (row.shopify_created_at) {
          const dk = toDateKey(new Date(row.shopify_created_at));
          entry.dailyMap.set(dk, (entry.dailyMap.get(dk) ?? 0) + price);
        }
      }

      const totalRevenue = Array.from(map.values()).reduce((s, e) => s + e.revenue, 0);

      return Array.from(map.entries())
        .map<ChannelStat>(([key, entry]) => {
          const meta = CHANNEL_META[key] ?? CHANNEL_META.unknown;
          return {
            key,
            name:         meta.name,
            revenue:      entry.revenue,
            orders:       entry.orders,
            aov:          entry.orders > 0 ? entry.revenue / entry.orders : 0,
            share:        totalRevenue > 0 ? Math.round((entry.revenue / totalRevenue) * 1000) / 10 : 0,
            color:        meta.color,
            dailyRevenue: last14.map(dk => entry.dailyMap.get(dk) ?? 0),
          };
        })
        .sort((a, b) => b.revenue - a.revenue);
    },
  });
}
