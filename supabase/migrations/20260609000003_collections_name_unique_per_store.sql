-- The original collections table had `name text UNIQUE NOT NULL` — a global
-- uniqueness constraint that prevents two stores from having a collection with
-- the same name (e.g. UK and KSA both having "Clearance Sale").
-- Drop it and replace with a per-store unique constraint.

ALTER TABLE public.collections DROP CONSTRAINT IF EXISTS collections_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_name_store
  ON public.collections(name, store_id)
  WHERE store_id IS NOT NULL;
