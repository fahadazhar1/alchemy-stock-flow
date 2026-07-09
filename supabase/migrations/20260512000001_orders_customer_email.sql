ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_email text;

CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON public.orders(customer_email)
  WHERE customer_email IS NOT NULL;
