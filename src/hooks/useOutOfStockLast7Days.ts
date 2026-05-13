import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStoreFilter } from "./useStoreFilter";

export interface OosProduct {
  product_id: string;
  name: string;
  sku: string;
  price: number;
  initialInventory: number;
  salesLast7d: number;
  currentInventory: number;
}

export function useOutOfStockLast7Days() {
  const { storeId } = useStoreFilter();

  return useQuery({
    queryKey: ["oos-last-7d", storeId],
    queryFn: async (): Promise<OosProduct[]> => {
      const { data, error } = await (supabase as any).rpc("get_oos_last_7_days", {
        p_store_id: storeId ?? null,
      });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r: any) => ({
        product_id:       String(r.product_id),
        name:             String(r.name  ?? "—"),
        sku:              String(r.sku   ?? "—"),
        price:            Number(r.price ?? 0),
        initialInventory: Number(r.initial_inventory ?? 0),
        salesLast7d:      Number(r.sales_last_7d     ?? 0),
        currentInventory: Number(r.current_inventory ?? 0),
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}
