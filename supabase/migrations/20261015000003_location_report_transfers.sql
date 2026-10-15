-- Location report + inter-location transfer suggestions.
-- Sales are attributed by orders.fulfillment_location_id (latest non-cancelled fulfilment);
-- orders not fulfilled yet have no location and are reported as their own row.

-- Sales per fulfilment location for a date range. Revenue = current_total_price (live, post-edit/refund).
CREATE OR REPLACE FUNCTION public.get_location_sales(p_store_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (store_id uuid, location_id text, location_name text, orders bigint, revenue numeric, units bigint)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  WITH o AS (
    SELECT o.id, o.store_id, o.fulfillment_location_id, o.fulfillment_location_name,
           COALESCE(o.current_total_price, o.total_price, 0) AS revenue
    FROM public.orders o
    WHERE o.cancelled_at IS NULL
      AND o.shopify_created_at >= p_from AND o.shopify_created_at < p_to
      AND (p_store_id IS NULL OR o.store_id = p_store_id)
  ), u AS (
    SELECT oi.order_id, SUM(oi.quantity) AS units
    FROM public.order_items oi JOIN o ON o.id = oi.order_id
    GROUP BY oi.order_id
  )
  SELECT o.store_id, o.fulfillment_location_id, COALESCE(max(o.fulfillment_location_name), 'Not fulfilled yet'),
         count(*), SUM(o.revenue), COALESCE(SUM(u.units), 0)::bigint
  FROM o LEFT JOIN u ON u.order_id = o.id
  GROUP BY o.store_id, o.fulfillment_location_id
  ORDER BY 5 DESC;
$$;

-- Top products sold from one location (NULL location id = not fulfilled yet).
CREATE OR REPLACE FUNCTION public.get_location_top_products(p_store_id uuid, p_from timestamptz, p_to timestamptz, p_location_id text, p_limit int DEFAULT 10)
RETURNS TABLE (product_id uuid, product_name text, units bigint, revenue numeric)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT oi.product_id, max(p.name), SUM(oi.quantity)::bigint, SUM(oi.quantity * COALESCE(oi.unit_price, 0))
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  LEFT JOIN public.products p ON p.id = oi.product_id
  WHERE o.cancelled_at IS NULL
    AND o.shopify_created_at >= p_from AND o.shopify_created_at < p_to
    AND (p_store_id IS NULL OR o.store_id = p_store_id)
    AND o.fulfillment_location_id IS NOT DISTINCT FROM p_location_id
  GROUP BY oi.product_id
  ORDER BY 3 DESC
  LIMIT p_limit;
$$;

-- Current stock held at each location (units + retail value at current price).
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
  GROUP BY il.store_id, il.shopify_location_id
  ORDER BY 3;
$$;

-- Transfer suggestions: a location selling a variant with < 14 days of cover, while another
-- location of the same store holds more than its own 30 days of need. Velocity per location =
-- units fulfilled from that location in the last 30 days. Suggested qty tops the short location
-- up to 30 days of cover without taking the donor below 30 days of its own cover.
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

GRANT EXECUTE ON FUNCTION public.get_location_sales(uuid, timestamptz, timestamptz) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_location_top_products(uuid, timestamptz, timestamptz, text, int) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_location_stock_summary(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_transfer_suggestions(uuid) TO authenticated, anon;
