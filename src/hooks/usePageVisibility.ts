import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export type PageVisibilityMap = Record<string, boolean>;

const KEY = "viewer_page_visibility";

export function usePageVisibility() {
  const queryClient = useQueryClient();

  const { data: visibilityMap = {}, isFetched } = useQuery<PageVisibilityMap>({
    queryKey: ["viewer-page-visibility"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("setting_value")
        .eq("setting_key", KEY)
        .maybeSingle();
      return (data?.setting_value ?? {}) as PageVisibilityMap;
    },
    staleTime: 60000,
  });

  const isPageVisible = (url: string): boolean => visibilityMap[url] !== false;

  const saveVisibility = async (map: PageVisibilityMap): Promise<boolean> => {
    const { data: existing } = await supabase
      .from("app_settings")
      .select("id")
      .eq("setting_key", KEY)
      .maybeSingle();

    const { error } = existing
      ? await supabase.from("app_settings").update({ setting_value: map as unknown as Json }).eq("setting_key", KEY)
      : await supabase.from("app_settings").insert({ setting_key: KEY, setting_value: map as unknown as Json });

    if (!error) queryClient.invalidateQueries({ queryKey: ["viewer-page-visibility"] });
    return !error;
  };

  return { visibilityMap, isPageVisible, isLoaded: isFetched, saveVisibility };
}
