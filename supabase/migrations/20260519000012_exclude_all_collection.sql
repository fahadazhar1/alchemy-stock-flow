-- Also exclude the "All" catch-all collection from dropdowns.
-- It exists purely as a storefront sort target (handle: "all") and
-- is not a meaningful category label for dashboard filters.

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
  AND c.name NOT ILIKE 'trending now'
  AND c.name NOT ILIKE 'all'
  ORDER BY c.name;
$$;
