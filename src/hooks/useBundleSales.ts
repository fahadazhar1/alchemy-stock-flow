import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStoreFilter } from "./useStoreFilter";
import { type DateBounds, getDateBounds } from "@/lib/dateRanges";

export interface BundleSales {
  bundleRevenue: number;
  othersRevenue: number;
  bundleOrders: number;
  othersOrders: number;
  bundleShare: number;
  totalRevenue: number;
  bundleDelta: number | null;
}

export function useBundleSales(bounds?: DateBounds) {
  const { storeId } = useStoreFilter();
  const b = bounds ?? getDateBounds("MTD");

  return useQuery({
    queryKey: ["bundle-sales", storeId, b.cacheKey],
    queryFn: async (): Promise<BundleSales> => {
      // Server-side aggregation — see migration 20260615000004_bundle_sales_rpc.sql.
      // Returns 5 numbers instead of up to 2× 10k line-revenue rows.
      const { data, error } = await (supabase as any).rpc("get_bundle_sales", {
        p_start_iso:      b.startISO,
        p_end_iso:        b.endISO,
        p_prev_start_iso: b.prevStartISO,
        p_prev_end_iso:   b.prevEndISO,
        p_store_id:       storeId ?? null,
      });
      if (error) throw error;

      const row = (Array.isArray(data) ? data[0] : data) as any;
      const bundleRevenue     = Number(row?.bundle_revenue      ?? 0);
      const othersRevenue     = Number(row?.others_revenue      ?? 0);
      const bundleOrders      = Number(row?.bundle_orders       ?? 0);
      const othersOrders      = Number(row?.others_orders       ?? 0);
      const prevBundleRevenue = Number(row?.prev_bundle_revenue ?? 0);

      const totalRevenue = bundleRevenue + othersRevenue;
      const bundleShare  = totalRevenue > 0
        ? Math.round((bundleRevenue / totalRevenue) * 100)
        : 0;
      const bundleDelta  = prevBundleRevenue > 0
        ? Math.round(((bundleRevenue - prevBundleRevenue) / prevBundleRevenue) * 100)
        : bundleRevenue > 0 ? 100 : null;

      return { bundleRevenue, othersRevenue, bundleOrders, othersOrders, totalRevenue, bundleShare, bundleDelta };
    },
  });
}
