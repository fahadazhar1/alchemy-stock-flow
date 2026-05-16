import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CODSummary {
  held:     { count: number; amount: number };
  released: { count: number; amount: number };
}

export function useCODSummary(storeId: string | null) {
  return useQuery<CODSummary>({
    queryKey: ["cod-summary", storeId],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_cod_payment_summary", {
        p_store_id: storeId ?? null,
      });
      if (error) throw error;
      return (data ?? { held: { count: 0, amount: 0 }, released: { count: 0, amount: 0 } }) as CODSummary;
    },
  });
}
