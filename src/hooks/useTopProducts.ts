import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStoreFilter } from "./useStoreFilter";
import { type DateBounds, getDateBounds } from "@/lib/dateRanges";

export interface TopProduct {
  product_id: string;
  name: string;
  sku: string;
  vendor: string;
  units: number;
  revenue: number;
  trend: number | null;
}

export function useTopProducts(limit = 6, bounds?: DateBounds) {
  const { storeId } = useStoreFilter();
  const b = bounds ?? getDateBounds("MTD");

  return useQuery({
    queryKey: ["top-products", storeId, limit, b.cacheKey],
    queryFn: async (): Promise<TopProduct[]> => {
      // Server-side aggregation — see migration 20260615000002_top_products_rpc.sql.
      // Returns `limit` rows instead of tens of thousands of order_items rows.
      const { data, error } = await (supabase as any).rpc("get_top_products", {
        p_start_iso:      b.startISO,
        p_end_iso:        b.endISO,
        p_prev_start_iso: b.prevStartISO,
        p_prev_end_iso:   b.prevEndISO,
        p_limit:          limit,
        p_store_id:       storeId ?? null,
      });
      if (error) throw error;

      return ((data ?? []) as any[]).map((r: any): TopProduct => ({
        product_id: r.product_id,
        name:       r.name   ?? "—",
        sku:        r.sku    ?? "—",
        vendor:     r.vendor ?? "—",
        units:      Number(r.units   ?? 0),
        revenue:    Number(r.revenue ?? 0),
        trend:      r.trend == null ? null : Number(r.trend),
      }));
    },
  });
}
