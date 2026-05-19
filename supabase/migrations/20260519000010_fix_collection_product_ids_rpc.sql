-- Fix get_collection_product_ids: remove c.store_id filter.
-- Products are always store-specific (p.store_id guarantees isolation).
-- Filtering by c.store_id breaks shared collection names (e.g. "Men" in both UK and PK)
-- during the transition window before a full re-sync assigns each store its own collection row.
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
