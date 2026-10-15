-- Hide the excluded (inactive merger) locations everywhere locations are shown:
-- Product Master location filter + By Location column, and the location product filter.
CREATE OR REPLACE FUNCTION public.excluded_location_ids()
RETURNS SETOF text
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT jsonb_array_elements_text(COALESCE((SELECT setting_value FROM public.app_settings WHERE setting_key = 'transfer_excluded_locations'), '[]'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public.get_store_locations(p_store_id uuid DEFAULT NULL)
RETURNS TABLE (store_id uuid, shopify_location_id text, location_name text, variants_count bigint, available_units bigint)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT il.store_id, il.shopify_location_id, max(il.location_name), count(*), sum(greatest(il.available_quantity, 0))
  FROM public.inventory_levels il
  WHERE il.variant_id IS NOT NULL AND (p_store_id IS NULL OR il.store_id = p_store_id)
    AND il.shopify_location_id NOT IN (SELECT public.excluded_location_ids())
  GROUP BY il.store_id, il.shopify_location_id
  ORDER BY 3;
$$;

CREATE OR REPLACE FUNCTION public.get_product_location_stock(p_product_ids uuid[])
RETURNS TABLE (product_id uuid, shopify_location_id text, location_name text, available bigint)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT v.product_id, il.shopify_location_id, max(il.location_name), sum(il.available_quantity)
  FROM public.inventory_levels il
  JOIN public.variants v ON v.id = il.variant_id
  WHERE v.product_id = ANY (p_product_ids)
    AND il.shopify_location_id NOT IN (SELECT public.excluded_location_ids())
  GROUP BY v.product_id, il.shopify_location_id
  ORDER BY 1, 3;
$$;

CREATE OR REPLACE FUNCTION public.get_location_product_ids(p_store_id uuid, p_location_id text)
RETURNS TABLE (product_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT DISTINCT v.product_id
  FROM public.inventory_levels il
  JOIN public.variants v ON v.id = il.variant_id
  WHERE il.shopify_location_id = p_location_id
    AND il.shopify_location_id NOT IN (SELECT public.excluded_location_ids())
    AND (p_store_id IS NULL OR il.store_id = p_store_id)
    AND il.available_quantity > 0;
$$;

GRANT EXECUTE ON FUNCTION public.excluded_location_ids() TO authenticated, anon;
