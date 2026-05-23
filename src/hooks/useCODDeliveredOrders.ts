import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CodDeliveredOrder {
  order_number:           string;
  order_date:             string | null;
  customer_email:         string | null;
  source_name:            string | null;
  store_name:             string | null;
  tracking_number:        string | null;
  courier:                string | null;
  courier_status:         string | null;
  courier_payment_status: string | null;
  order_total:            number | null;
  cod_amount:             number | null;
  shipping_charges:       number | null; // weight charges
  fuel_surcharge:         number | null;
  gst:                    number | null;
  wht:                    number | null;
  cod_sst:                number | null;
  net_receivable:         number | null;
  remittance_date:        string | null;
}

export function useCODDeliveredOrders(
  storeId:  string | null,
  released: boolean,
  enabled:  boolean,
) {
  return useQuery<CodDeliveredOrder[]>({
    queryKey: ["cod-delivered-orders", storeId, released],
    enabled,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_cod_delivered_orders", {
        p_store_id: storeId ?? null,
        p_released: released,
      });
      if (error) throw error;
      return (data ?? []) as CodDeliveredOrder[];
    },
  });
}
