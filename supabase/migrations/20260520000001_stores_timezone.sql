ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'Europe/London';
