-- Add p_days parameter so the widget can switch between 7 / 15 / 30 / 60 day windows.

DROP FUNCTION IF EXISTS public.get_oos_last_7_days(uuid);

CREATE FUNCTION public.get_oos_last_7_days(
  p_store_id uuid    DEFAULT NULL,
  p_days     integer DEFAULT 7
)
RETURNS TABLE (
  product_id                     uuid,
  name                           text,
  sku                            text,
  price                          numeric,
  units_sold_7d                  bigint,
  revenue_7d                     numeric,
  estimated_lost_revenue_per_day numeric,
  last_sold_at                   timestamptz,
  current_inventory              bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH
  all_sales AS (
    SELECT
      oi.product_id,
      SUM(oi.quantity)::bigint         AS units_sold_7d,
      SUM(oi.quantity * oi.unit_price) AS revenue_7d,
      MAX(o.shopify_created_at)        AS last_sold_at
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.shopify_created_at >= NOW() - (p_days || ' days')::interval
      AND o.cancelled_at IS NULL
      AND (p_store_id IS NULL OR o.store_id = p_store_id)
    GROUP BY oi.product_id
  ),
  ranked_sales AS (
    SELECT *,
      NTILE(4) OVER (ORDER BY units_sold_7d DESC, revenue_7d DESC) AS quartile
    FROM all_sales
  ),
  product_inv AS (
    SELECT
      v.product_id,
      SUM(v.inventory_quantity)::bigint AS total_inv,
      MIN(v.price)                      AS min_price
    FROM public.variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE (p_store_id IS NULL OR p.store_id = p_store_id)
    GROUP BY v.product_id
  )
  SELECT
    p.id                       AS product_id,
    p.name                     AS name,
    p.sku                      AS sku,
    pi.min_price               AS price,
    s.units_sold_7d            AS units_sold_7d,
    s.revenue_7d               AS revenue_7d,
    (s.revenue_7d / p_days)    AS estimated_lost_revenue_per_day,
    s.last_sold_at             AS last_sold_at,
    pi.total_inv               AS current_inventory
  FROM public.products p
  JOIN product_inv    pi ON pi.product_id = p.id
  JOIN ranked_sales   s  ON s.product_id  = p.id
  WHERE pi.total_inv = 0
    AND s.quartile   = 1
  ORDER BY s.units_sold_7d DESC, s.revenue_7d DESC
$$;

GRANT EXECUTE ON FUNCTION public.get_oos_last_7_days(uuid, integer)
  TO authenticated, anon;
