import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStoreFilter } from "./useStoreFilter";

export interface OosProduct {
  product_id: string;
  name: string;
  sku: string;
  price: number;
  unitsSold: number;
  revenue: number;
  estimatedLostRevenuePerDay: number;
  lastSoldAt: string | null;
  currentInventory: number;
}

export function useOutOfStockBestSellers(days: number = 7) {
  const { storeId } = useStoreFilter();

  return useQuery({
    queryKey: ["oos-best-sellers", storeId, days],
    queryFn: async (): Promise<OosProduct[]> => {
      const { data, error } = await (supabase as any).rpc("get_oos_last_7_days", {
        p_store_id: storeId ?? null,
        p_days:     days,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r: any) => ({
        product_id:                 String(r.product_id),
        name:                       String(r.name  ?? "—"),
        sku:                        String(r.sku   ?? "—"),
        price:                      Number(r.price ?? 0),
        unitsSold:                  Number(r.units_sold_7d               ?? 0),
        revenue:                    Number(r.revenue_7d                  ?? 0),
        estimatedLostRevenuePerDay: Number(r.estimated_lost_revenue_per_day ?? 0),
        lastSoldAt:                 r.last_sold_at ? String(r.last_sold_at) : null,
        currentInventory:           Number(r.current_inventory           ?? 0),
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}

// backwards-compat alias
export const useOutOfStockLast7Days = () => useOutOfStockBestSellers(7);
