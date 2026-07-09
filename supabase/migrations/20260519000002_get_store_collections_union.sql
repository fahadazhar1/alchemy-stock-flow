-- Update get_store_collections to union both collection sources:
-- 1. products.collection_id (primary FK — last collection synced per product)
-- 2. product_collections junction (all collections, including smart ones)
-- Old data synced before product_collections existed only has source 1.
CREATE OR REPLACE FUNCTION get_store_collections(p_store_id uuid)
RETURNS TABLE(id uuid, name text)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT c.id, c.name
  FROM collections c
  WHERE c.id IN (
    SELECT p.collection_id
    FROM products p
    WHERE p.store_id = p_store_id
      AND p.collection_id IS NOT NULL
    UNION
    SELECT pc.collection_id
    FROM product_collections pc
    JOIN products p ON p.id = pc.product_id
    WHERE p.store_id = p_store_id
  )
  ORDER BY c.name;
$$;
