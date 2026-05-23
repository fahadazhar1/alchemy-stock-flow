ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS total_discounts numeric(12,2);
