-- Locations excluded from transfer suggestions (as donor or receiver), kept in app_settings so
-- they can be changed without a migration. Initially: UK store's 4-store-merger locations
-- (Darussalam KSA / PK / UAE) — the merger isn't live, so they aren't real stock to move.
INSERT INTO public.app_settings (setting_key, setting_value, description)
SELECT 'transfer_excluded_locations', '["87494230151","87494197383","87494262919"]'::jsonb,
       'Shopify location ids hidden from Replenishment transfer suggestions (UK merger locations: Darussalam KSA, PK, UAE)'
WHERE NOT EXISTS (SELECT 1 FROM public.app_settings WHERE setting_key = 'transfer_excluded_locations');

CREATE OR REPLACE FUNCTION public.get_transfer_suggestions(p_store_id uuid DEFAULT NULL)
RETURNS TABLE (
  store_id uuid, product_id uuid, variant_id uuid, product_name text, variant_title text, variant_count int, sku text,
  to_location_id text, to_location text, to_available int, to_sold_30d int, to_days_cover numeric,
  from_location_id text, from_location text, from_available int, from_sold_30d int,
  suggested_qty int, urgency text
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  WITH sales AS (
    SELECT oi.variant_id, o.fulfillment_location_id AS loc, SUM(oi.quantity)::int AS u30
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.cancelled_at IS NULL
      AND o.shopify_created_at >= now() - interval '30 days'
      AND o.fulfillment_location_id IS NOT NULL
      AND oi.variant_id IS NOT NULL
      AND (p_store_id IS NULL OR o.store_id = p_store_id)
    GROUP BY 1, 2
  ), lv AS (
    SELECT il.variant_id, il.store_id, il.shopify_location_id AS loc, il.location_name,
           greatest(il.available_quantity, 0) AS avail, COALESCE(s.u30, 0) AS u30
    FROM public.inventory_levels il
    LEFT JOIN sales s ON s.variant_id = il.variant_id AND s.loc = il.shopify_location_id
    WHERE il.variant_id IS NOT NULL
      AND (p_store_id IS NULL OR il.store_id = p_store_id)
      AND il.shopify_location_id NOT IN (
        SELECT jsonb_array_elements_text(COALESCE((SELECT setting_value FROM public.app_settings WHERE setting_key = 'transfer_excluded_locations'), '[]'::jsonb))
      )
  ), need AS (
    SELECT lv.*, lv.avail / (lv.u30 / 30.0) AS days_cover, greatest(ceil(lv.u30) - lv.avail, 0)::int AS shortfall
    FROM lv WHERE lv.u30 > 0 AND lv.avail / (lv.u30 / 30.0) < 14
  ), supply AS (
    SELECT lv.*, greatest(lv.avail - ceil(lv.u30), 0)::int AS surplus FROM lv
  ), pick AS (
    SELECT DISTINCT ON (n.variant_id, n.loc)
      n.store_id, n.variant_id, n.loc AS to_loc, n.location_name AS to_name, n.avail AS to_avail, n.u30 AS to_u30,
      n.days_cover, n.shortfall, s.loc AS from_loc, s.location_name AS from_name, s.avail AS from_avail, s.u30 AS from_u30, s.surplus
    FROM need n
    JOIN supply s ON s.variant_id = n.variant_id AND s.loc <> n.loc AND s.surplus > 0
    WHERE n.shortfall > 0
    ORDER BY n.variant_id, n.loc, s.surplus DESC
  )
  SELECT pk.store_id, p.id, pk.variant_id, p.name, NULLIF(v.size, 'Default Title'),
         (SELECT count(*) FROM public.variants v2 WHERE v2.product_id = p.id)::int,
         COALESCE(NULLIF(v.variant_sku, ''), p.sku),
         pk.to_loc, pk.to_name, pk.to_avail, pk.to_u30, ROUND(pk.days_cover::numeric, 1),
         pk.from_loc, pk.from_name, pk.from_avail, pk.from_u30,
         least(pk.shortfall, pk.surplus),
         CASE WHEN pk.days_cover < 3 THEN 'Critical' WHEN pk.days_cover < 7 THEN 'Soon' ELSE 'Plan' END
  FROM pick pk
  JOIN public.variants v ON v.id = pk.variant_id
  JOIN public.products p ON p.id = v.product_id
  WHERE p.status = 'active'
  ORDER BY pk.days_cover ASC, least(pk.shortfall, pk.surplus) DESC;
$$;

