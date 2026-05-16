ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS currency        text DEFAULT 'GBP',
  ADD COLUMN IF NOT EXISTS currency_symbol text DEFAULT '£';
