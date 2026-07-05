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

export const CHANNEL_META: Record<string, { name: string; color: string }> = {
  web:                  { name: "Online Store",  color: "#5E5CE6" },
  pos:                  { name: "Point of Sale", color: "#10B981" },
  shop:                 { name: "Shop App",      color: "#EC4899" },
  shopify_draft_orders: { name: "Draft Orders",  color: "#F59E0B" },
  wholesale:            { name: "Wholesale",     color: "#3B82F6" },
  exchange:             { name: "Exchange",      color: "#6B7280" },
  subscription:         { name: "Subscription",  color: "#8B5CF6" },
  amazon:               { name: "Amazon",        color: "#FF9900" },
  ebay:                 { name: "eBay",          color: "#E53238" },
  google:               { name: "Google",        color: "#4285F4" },
  facebook:             { name: "Facebook",      color: "#1877F2" },
  instagram:            { name: "Instagram",     color: "#E1306C" },
  tiktok:               { name: "TikTok",        color: "#69C9D0" },
  etsy:                 { name: "Etsy",          color: "#F56400" },
  walmart:              { name: "Walmart",       color: "#0071CE" },
  admin:                { name: "Admin",         color: "#6B7280" },
  unknown:              { name: "Other",         color: "#9CA3AF" },
};

export function normalizeKey(source: string | null): string {
  const k = (source ?? "").toLowerCase().trim();
  if (k === "" || k === "null") return "admin";
  if (k === "web" || k.includes("online_store") || k.includes("online store")) return "web";
  if (k === "pos" || k.includes("point_of_sale") || k.includes("point of sale")) return "pos";
  if (k === "android" || k === "iphone" || k === "shop") return "shop";
  if (k.includes("amazon")) return "amazon";
  if (k.includes("ebay")) return "ebay";
  if (k.includes("google")) return "google";
  if (k.includes("facebook") || k === "fb") return "facebook";
  if (k.includes("instagram") || k === "ig") return "instagram";
  if (k.includes("tiktok") || k.includes("tik_tok") || k.includes("tik tok")) return "tiktok";
  if (k.includes("etsy")) return "etsy";
  if (k.includes("walmart")) return "walmart";
  if (k.includes("wholesale")) return "wholesale";
  if (k.includes("subscription")) return "subscription";
  if (k.includes("draft")) return "shopify_draft_orders";
  if (CHANNEL_META[k]) return k;
  return "unknown";
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function useChannelPerformance(days = 30, bounds?: DateBounds) {
  const { storeId } = useStoreFilter();
  const b = bounds ?? getDateBounds("MTD");

  return useQuery({
    queryKey: ["channel-performance", storeId, b.cacheKey],
    queryFn: async (): Promise<ChannelStat[]> => {
      // Server-side pre-aggregation by raw source_name + UTC day.
      // See migration 20260615000003_channel_performance_rpc.sql.
      // normalizeKey folding + the sparkline are kept in JS, verbatim.
      const { data, error } = await (supabase as any).rpc("get_channel_performance", {
        p_start_iso: b.startISO,
        p_end_iso:   b.endISO,
        p_store_id:  storeId ?? null,
      });
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

      // Each row is one (source_name, day) bucket; fold raw sources into channels.
      for (const row of (data ?? []) as any[]) {
        const key = normalizeKey(row.source_name);
        if (!map.has(key)) map.set(key, { revenue: 0, orders: 0, dailyMap: new Map() });
        const entry = map.get(key)!;
        const revenue = Number(row.revenue) || 0;
        entry.revenue += revenue;
        entry.orders  += Number(row.orders) || 0;
        if (row.bucket_date) {
          const dk = row.bucket_date as string; // "YYYY-MM-DD" UTC date — same key space as last14
          entry.dailyMap.set(dk, (entry.dailyMap.get(dk) ?? 0) + revenue);
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
