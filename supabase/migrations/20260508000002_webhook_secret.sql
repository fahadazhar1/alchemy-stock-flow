ALTER TABLE public.shopify_connections
  ADD COLUMN IF NOT EXISTS webhook_secret text;
