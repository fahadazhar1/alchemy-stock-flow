ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shopify_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS total_price numeric(12,2);

CREATE INDEX IF NOT EXISTS idx_orders_shopify_created_at ON public.orders(shopify_created_at);
