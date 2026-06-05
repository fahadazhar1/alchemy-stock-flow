CREATE TABLE IF NOT EXISTS public.abandoned_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  shopify_checkout_token text NOT NULL,
  created_at timestamptz,
  completed_at timestamptz,
  email text,
  total_price numeric,
  source_name text,
  referring_site text,
  landing_site text,
  currency text,
  UNIQUE (store_id, shopify_checkout_token)
);

ALTER TABLE public.abandoned_checkouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_abandoned_checkouts" ON public.abandoned_checkouts
  FOR SELECT USING (true);
CREATE POLICY "insert_abandoned_checkouts" ON public.abandoned_checkouts
  FOR INSERT WITH CHECK (true);
CREATE POLICY "update_abandoned_checkouts" ON public.abandoned_checkouts
  FOR UPDATE USING (true);

CREATE INDEX IF NOT EXISTS abandoned_checkouts_store_created
  ON public.abandoned_checkouts (store_id, created_at);
