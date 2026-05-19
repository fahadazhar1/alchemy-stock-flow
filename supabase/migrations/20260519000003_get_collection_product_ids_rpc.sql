-- Returns product IDs belonging to a named collection within a specific store.
-- Uses the product_collections junction table (not products.collection_id FK)
-- so it works correctly even when products.collection_id is overwritten by sync.
CREATE OR REPLACE FUNCTION get_collection_product_ids(p_collection_name text, p_store_id uuid)
RETURNS TABLE(product_id uuid)
LANGUAGE sql STABLE AS $$
  SELECT p.id
  FROM products p
  JOIN product_collections pc ON pc.product_id = p.id
  JOIN collections c ON c.id = pc.collection_id
  WHERE c.name = p_collection_name
    AND p.store_id = p_store_id;
$$;
