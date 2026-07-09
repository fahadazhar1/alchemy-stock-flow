-- Returns all distinct collections that have at least one product belonging
-- to the given store, via the product_collections junction table.
-- Bypasses the Supabase 1000-row client limit on multi-hop queries.
CREATE OR REPLACE FUNCTION get_store_collections(p_store_id uuid)
RETURNS TABLE(id uuid, name text)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT c.id, c.name
  FROM collections c
  JOIN product_collections pc ON pc.collection_id = c.id
  JOIN products p ON p.id = pc.product_id
  WHERE p.store_id = p_store_id
  ORDER BY c.name;
$$;
