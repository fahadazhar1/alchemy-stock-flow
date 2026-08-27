-- Collection Sort Manager: tracks every sort run for audit and "last run" display
CREATE TABLE IF NOT EXISTS public.collection_sort_runs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            text        NOT NULL,
  run_at              timestamptz NOT NULL DEFAULT now(),
  collections_sorted  integer     NOT NULL DEFAULT 0,
  products_reordered  integer     NOT NULL DEFAULT 0,
  errors              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  sort_rules          jsonb,
  collection_scope    jsonb
);

ALTER TABLE public.collection_sort_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for demo"
  ON public.collection_sort_runs
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_collection_sort_runs_store_id
  ON public.collection_sort_runs (store_id);

CREATE INDEX idx_collection_sort_runs_run_at
  ON public.collection_sort_runs (run_at DESC);
