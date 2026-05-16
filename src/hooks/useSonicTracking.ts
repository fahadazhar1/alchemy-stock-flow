import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SonicTrackingData {
  courier:                "sonic" | "mandp" | null;
  courier_status:         string | null;
  courier_payment_status: string | null;
  shipping_charges:       number | null;
  fuel_surcharge:         number | null;
  gst:                    number | null;
  remittance_date:        string | null;
}

export function useSonicTracking(trackingNumbers: (string | null | undefined)[]) {
  const valid = trackingNumbers.filter((tn): tn is string => !!tn);
  const key = valid.slice().sort().join(",");

  return useQuery<Record<string, SonicTrackingData | null>>({
    queryKey: ["sonic-tracking", key],
    enabled: valid.length > 0,
    staleTime: 5 * 60 * 1000, // matches cron frequency
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("sonic-tracking", {
        body: { tracking_numbers: valid },
      });
      if (error) throw error;
      return (data?.data ?? {}) as Record<string, SonicTrackingData | null>;
    },
  });
}
