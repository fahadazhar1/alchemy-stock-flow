ALTER TABLE public.shopify_sync_logs
  ADD COLUMN IF NOT EXISTS current_stage text,
  ADD COLUMN IF NOT EXISTS current_page integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cursor text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;
