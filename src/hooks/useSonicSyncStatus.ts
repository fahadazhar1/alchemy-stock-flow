import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SonicSyncStatus {
  total: number;
  synced: number;
  pending: number;
  lastSyncedAt: Date | null;
}

export function useSonicSyncStatus(storeId?: string | null) {
  return useQuery<SonicSyncStatus>({
    queryKey: ["sonic-sync-status", storeId ?? "all"],
    refetchInterval: 30_000,
    queryFn: async () => {
      let totalQuery = supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .not("tracking_number", "is", null)
        .is("cancelled_at", null);

      if (storeId) totalQuery = totalQuery.eq("store_id", storeId) as typeof totalQuery;

      const [{ count: total }, { count: synced }, { data: latest }] = await Promise.all([
        totalQuery,
        supabase.from("sonic_cache").select("*", { count: "exact", head: true }),
        supabase
          .from("sonic_cache")
          .select("last_synced_at")
          .order("last_synced_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const t = total ?? 0;
      const s = Math.min(synced ?? 0, t);

      return {
        total: t,
        synced: s,
        pending: t - s,
        lastSyncedAt: latest?.last_synced_at ? new Date(latest.last_synced_at as string) : null,
      };
    },
  });
}
