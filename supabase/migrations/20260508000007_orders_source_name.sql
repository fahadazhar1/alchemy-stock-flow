ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS source_name text;
