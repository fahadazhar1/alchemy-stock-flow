ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS discount_codes  jsonb,
  ADD COLUMN IF NOT EXISTS referring_site  text,
  ADD COLUMN IF NOT EXISTS landing_site    text;

CREATE INDEX IF NOT EXISTS idx_orders_referring_site
  ON public.orders (referring_site)
  WHERE referring_site IS NOT NULL;
