-- Also hide the excluded (inactive merger) locations from the Location Report stock cards.
UPDATE public.app_settings
SET description = 'Shopify location ids hidden from Replenishment transfer suggestions and the Location Report (UK merger locations: Darussalam KSA, PK, UAE)'
WHERE setting_key = 'transfer_excluded_locations';

CREATE OR REPLACE FUNCTION public.get_location_stock_summary(p_store_id uuid)
RETURNS TABLE (store_id uuid, location_id text, location_name text, skus_in_stock bigint, units bigint, stock_value numeric)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT il.store_id, il.shopify_location_id, max(il.location_name),
         count(*) FILTER (WHERE il.available_quantity > 0),
         COALESCE(SUM(greatest(il.available_quantity, 0)), 0)::bigint,
         COALESCE(SUM(greatest(il.available_quantity, 0) * COALESCE(v.price, 0)), 0)
  FROM public.inventory_levels il
  JOIN public.variants v ON v.id = il.variant_id
  WHERE (p_store_id IS NULL OR il.store_id = p_store_id)
    AND il.shopify_location_id NOT IN (
      SELECT jsonb_array_elements_text(COALESCE((SELECT setting_value FROM public.app_settings WHERE setting_key = 'transfer_excluded_locations'), '[]'::jsonb))
    )
  GROUP BY il.store_id, il.shopify_location_id
  ORDER BY 3;
$$;
