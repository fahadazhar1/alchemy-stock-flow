import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface SEOSyncState {
  syncing: boolean;
  processed: number;
  total: number;
  percent: number;
  label: string;
}

export function useSEOSync(storeId: string | null) {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [state, setState] = useState<SEOSyncState>({
    syncing: false, processed: 0, total: 0, percent: 0, label: "",
  });

  useEffect(() => {
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, []);

  const sync = async () => {
    if (state.syncing) return;

    const channelName = `seo-sync-${storeId ?? "all"}`;

    setState({ syncing: true, processed: 0, total: 0, percent: 0, label: "Connecting to Shopify…" });

    const channel = supabase.channel(channelName);
    channelRef.current = channel;

    channel.on(
      "broadcast",
      { event: "progress" },
      (msg: { payload: { processed: number; total: number } }) => {
        const { processed = 0, total = 0 } = msg.payload ?? {};
        const percent = total > 0 ? Math.min(Math.round((processed / total) * 100), 99) : 0;
        setState(prev => ({
          ...prev,
          processed,
          total,
          percent,
          label: total > 0
            ? `Syncing ${processed} / ${total} products…`
            : `Syncing ${processed} products…`,
        }));
      }
    );

    await channel.subscribe();

    try {
      const { data, error } = await supabase.functions.invoke("shopify-sync-seo", {
        body: { store_id: storeId ?? undefined },
      });

      if (error) throw new Error(error.message);
      if (!data?.total_updated && data?.results?.[0]?.error) {
        throw new Error(data.results[0].error);
      }

      setState(prev => ({ ...prev, percent: 100, label: `Done — ${data?.total_updated ?? 0} products updated` }));
      toast.success(`SEO sync complete — ${data?.total_updated ?? 0} products updated`);
      await queryClient.invalidateQueries({ queryKey: ["seo-audit"] });
    } catch (e: any) {
      const msg = e?.message ?? "Unknown error";
      toast.error("SEO sync failed: " + msg);
      setState(prev => ({ ...prev, label: "Sync failed: " + msg }));
    } finally {
      supabase.removeChannel(channel);
      channelRef.current = null;
      setTimeout(() => setState({ syncing: false, processed: 0, total: 0, percent: 0, label: "" }), 2500);
    }
  };

  return { ...state, sync };
}
