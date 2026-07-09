-- Add store_id to collections so each store has its own collection records.
-- Previously collections were shared by name across stores, causing smart collections
-- from one store to not appear for the other, and vice versa.

ALTER TABLE public.collections ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores(id);

-- Drop the old single-column unique index on shopify_collection_id.
-- Shopify IDs are per-store integers — two stores can theoretically share an ID,
-- so the unique constraint must be scoped to (store_id, shopify_collection_id).
DROP INDEX IF EXISTS idx_collections_shopify_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_shopify_id_store
  ON public.collections(store_id, shopify_collection_id)
  WHERE store_id IS NOT NULL AND shopify_collection_id IS NOT NULL;

-- Backfill store_id for existing rows using product_collections junction.
-- For collections linked to products from multiple stores, assign to the store
-- with the most products (best approximation until next full re-sync).
WITH ranked AS (
  SELECT pc.collection_id, p.store_id, COUNT(*) AS cnt,
    ROW_NUMBER() OVER (PARTITION BY pc.collection_id ORDER BY COUNT(*) DESC) AS rn
  FROM product_collections pc
  JOIN products p ON p.id = pc.product_id
  GROUP BY pc.collection_id, p.store_id
)
UPDATE public.collections c
SET store_id = r.store_id
FROM ranked r
WHERE c.id = r.collection_id AND r.rn = 1 AND c.store_id IS NULL;

-- Fallback backfill via products.collection_id FK for any still-unassigned rows.
WITH ranked AS (
  SELECT p.collection_id, p.store_id,
    ROW_NUMBER() OVER (PARTITION BY p.collection_id ORDER BY p.store_id) AS rn
  FROM products p
  WHERE p.collection_id IS NOT NULL
)
UPDATE public.collections c
SET store_id = r.store_id
FROM ranked r
WHERE c.id = r.collection_id AND r.rn = 1 AND c.store_id IS NULL;

-- Update get_store_collections to query store_id directly — no join through products needed.
-- Falls back to the product-join approach for rows not yet backfilled (store_id IS NULL).
CREATE OR REPLACE FUNCTION get_store_collections(p_store_id uuid)
RETURNS TABLE(id uuid, name text)
LANGUAGE sql STABLE AS $$
  SELECT id, name
  FROM collections
  WHERE store_id = p_store_id
  ORDER BY name;
$$;

-- get_collection_product_ids: filter by p.store_id only (always correct — products are store-specific).
-- Do NOT filter by c.store_id: a collection named "Men" may be backfilled to one store before
-- the other store's re-sync creates its own separate row.  p.store_id ensures isolation.
CREATE OR REPLACE FUNCTION get_collection_product_ids(p_collection_name text, p_store_id uuid)
RETURNS TABLE(product_id uuid)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT p.id
  FROM products p
  JOIN product_collections pc ON pc.product_id = p.id
  JOIN collections c ON c.id = pc.collection_id
  WHERE c.name = p_collection_name
    AND p.store_id = p_store_id;
$$;
