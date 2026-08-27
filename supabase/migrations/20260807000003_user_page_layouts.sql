-- Per-account custom section order for dashboard pages (starting with P&L).
-- One row per (user, page); section_order is an ordered array of section
-- keys, read by the frontend to decide render order. Falls back to the
-- page's built-in default order when no row exists yet.

CREATE TABLE public.user_page_layouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page          text NOT NULL,
  section_order jsonb NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, page)
);

ALTER TABLE public.user_page_layouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own layout"
  ON public.user_page_layouts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert their own layout"
  ON public.user_page_layouts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own layout"
  ON public.user_page_layouts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own layout"
  ON public.user_page_layouts FOR DELETE
  USING (auth.uid() = user_id);
