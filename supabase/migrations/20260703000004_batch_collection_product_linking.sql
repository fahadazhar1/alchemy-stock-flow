-- shopify-sync Phase 2 was doing one UPDATE + one UPSERT per product per collection page
-- (up to 500 individual PostgREST round trips per 250-product page). pg_stat_statements
-- showed 751k+ product_collections inserts and 718k+ products.collection_id updates —
-- the dominant source of request volume/egress on the project. This RPC lets the whole
-- page's primary-collection assignment happen in a single statement.
CREATE OR REPLACE FUNCTION set_products_primary_collection(
  p_product_ids uuid[],
  p_collection_id uuid,
  p_force boolean
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.products
  SET collection_id = p_collection_id
  WHERE id = ANY(p_product_ids) AND (p_force OR collection_id IS NULL);
$$;

GRANT EXECUTE ON FUNCTION set_products_primary_collection(uuid[], uuid, boolean) TO authenticated, anon, service_role;
