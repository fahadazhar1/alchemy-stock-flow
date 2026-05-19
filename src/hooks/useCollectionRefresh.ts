import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface CollectionRefreshProgress {
  stage: "idle" | "fetching_manual" | "fetching_smart" | "done";
  manual: number;
  smart: number;
  percent: number;
}

const STAGE_PERCENT: Record<string, number> = {
  idle: 0,
  fetching_manual: 15,
  fetching_smart: 55,
  done: 100,
};

function stageLabel(stage: string, manual: number, smart: number): string {
  if (stage === "fetching_manual") return manual > 0 ? `Fetching manual collections… (${manual})` : "Fetching manual collections…";
  if (stage === "fetching_smart") return smart > 0 ? `Fetching smart collections… (${smart})` : "Fetching smart collections…";
  if (stage === "done") return `Done — ${manual} manual, ${smart} smart`;
  return "";
}

export function useCollectionRefresh(storeId: string | null, queryKeys: string[][]) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<CollectionRefreshProgress>({
    stage: "idle", manual: 0, smart: 0, percent: 0,
  });
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Cleanup channel on unmount
  useEffect(() => {
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, []);

  const refresh = async () => {
    if (!storeId || progress.stage !== "idle") return;

    setProgress({ stage: "fetching_manual", manual: 0, smart: 0, percent: STAGE_PERCENT.fetching_manual });

    // Subscribe to real-time progress broadcast before invoking the function
    const channel = supabase.channel(`collection-sync-${storeId}`);
    channelRef.current = channel;

    channel.on("broadcast", { event: "progress" }, (msg: { payload: { stage: string; custom: number; smart: number } }) => {
      const { stage, custom = 0, smart = 0 } = msg.payload ?? {};
      // Interpolate percent within stage bands so the bar moves smoothly
      const base = STAGE_PERCENT[stage] ?? STAGE_PERCENT.fetching_manual;
      const mappedStage =
        stage === "fetching_manual" ? "fetching_manual"
        : stage === "fetching_smart" ? "fetching_smart"
        : stage === "done" ? "done"
        : "fetching_manual";

      setProgress({ stage: mappedStage, manual: custom, smart, percent: base });
    });

    await channel.subscribe();

    try {
      const { data: fn, error } = await supabase.functions.invoke("shopify-sync", {
        body: { action: "sync_collections_meta", store_id: storeId },
      });

      if (error || !fn?.ok) {
        toast.error(fn?.error ?? error?.message ?? "Failed to refresh collections");
      } else {
        // Invalidate all provided query keys so dropdowns re-fetch
        for (const key of queryKeys) {
          await queryClient.invalidateQueries({ queryKey: key });
        }
        toast.success(`Collections refreshed — ${fn.custom} manual, ${fn.smart} smart`);
      }
    } catch {
      toast.error("Failed to refresh collections");
    } finally {
      supabase.removeChannel(channel);
      channelRef.current = null;
      // Hold "done" state briefly so user sees 100%, then reset
      setTimeout(() => setProgress({ stage: "idle", manual: 0, smart: 0, percent: 0 }), 2000);
    }
  };

  const isRefreshing = progress.stage !== "idle";
  const label = stageLabel(progress.stage, progress.manual, progress.smart);

  return { progress, isRefreshing, label, refresh };
}
