import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Per-account custom section order for a dashboard page. Falls back to
 *  `defaultOrder` when the user has never customized this page, and
 *  future sections (not yet in a saved order) are appended at the end
 *  rather than dropped. */
export function usePageLayout(page: string, defaultOrder: string[]) {
  const queryClient = useQueryClient();
  const queryKey = ["page-layout", page];

  const { data, isLoading } = useQuery({
    queryKey,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string[] | null> => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return null;
      const { data, error } = await (supabase as any)
        .from("user_page_layouts")
        .select("section_order")
        .eq("page", page)
        .eq("user_id", userData.user.id)
        .maybeSingle();
      if (error) throw error;
      return (data?.section_order as string[] | undefined) ?? null;
    },
  });

  const order = (() => {
    if (!data || data.length === 0) return defaultOrder;
    const known = data.filter(k => defaultOrder.includes(k));
    const missing = defaultOrder.filter(k => !known.includes(k));
    return [...known, ...missing];
  })();

  const save = useMutation({
    mutationFn: async (newOrder: string[]) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Not signed in");
      const { error } = await (supabase as any)
        .from("user_page_layouts")
        .upsert(
          { user_id: userData.user.id, page, section_order: newOrder, updated_at: new Date().toISOString() },
          { onConflict: "user_id,page" },
        );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const reset = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("Not signed in");
      const { error } = await supabase.from("user_page_layouts").delete().eq("page", page).eq("user_id", userData.user.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return { order, isLoading, isCustomized: !!data, save, reset };
}
