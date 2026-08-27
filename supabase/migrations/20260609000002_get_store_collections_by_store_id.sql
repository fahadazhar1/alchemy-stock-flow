-- Return all collections for a store directly from collections.store_id.
-- Previously filtered through product links, so new/empty collections (e.g. Clearance Sale)
-- were invisible even after sync_collections_meta saved them.

CREATE OR REPLACE FUNCTION get_store_collections(p_store_id uuid)
RETURNS TABLE(id uuid, name text)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT c.id, c.name
  FROM collections c
  WHERE c.store_id = p_store_id
    AND c.name NOT ILIKE 'trending now'
    AND c.name NOT ILIKE 'all'
  ORDER BY c.name;
$$;
