-- RPCs for collection filtering in Product Master
-- (replaces multi-query client-side approach with clean server-side functions)

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
