-- ── get_oos_last_7_days v2 ────────────────────────────────────────────────────
-- Best-selling products (by revenue) that had sales in the last rolling 7 days
-- and are currently out of stock (sum of variant inventory = 0).
-- Intended for CEO-facing "revenue at risk" view — no historical snapshots used.
--
-- Parameters:
--   p_store_id – optional store filter (NULL = all stores)

DROP FUNCTION IF EXISTS public.get_oos_last_7_days(uuid);

CREATE FUNCTION public.get_oos_last_7_days(
  p_store_id uuid DEFAULT NULL
)
RETURNS TABLE (
  product_id                    uuid,
  name                          text,
  sku                           text,
  price                         numeric,
  units_sold_7d                 bigint,
  revenue_7d                    numeric,
  estimated_lost_revenue_per_day numeric,
  last_sold_at                  timestamptz,
  current_inventory             bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH
  sales AS (
    SELECT
      oi.product_id,
      SUM(oi.quantity)::bigint                  AS units_sold_7d,
      SUM(oi.quantity * oi.unit_price)          AS revenue_7d,
      MAX(o.shopify_created_at)                 AS last_sold_at
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.shopify_created_at >= NOW() - INTERVAL '7 days'
      AND o.cancelled_at IS NULL
      AND (p_store_id IS NULL OR o.store_id = p_store_id)
    GROUP BY oi.product_id
  ),
  product_inv AS (
    SELECT
      v.product_id,
      SUM(v.inventory_quantity)::bigint AS total_inv,
      MIN(v.price)                      AS min_price
    FROM public.variants v
    GROUP BY v.product_id
  )
  SELECT
    p.id                                AS product_id,
    p.name                              AS name,
    p.sku                               AS sku,
    pi.min_price                        AS price,
    s.units_sold_7d                     AS units_sold_7d,
    s.revenue_7d                        AS revenue_7d,
    (s.revenue_7d / 7)                  AS estimated_lost_revenue_per_day,
    s.last_sold_at                      AS last_sold_at,
    pi.total_inv                        AS current_inventory
  FROM public.products   p
  JOIN product_inv       pi ON pi.product_id = p.id
  JOIN sales             s  ON s.product_id  = p.id
  WHERE pi.total_inv = 0
  ORDER BY s.revenue_7d DESC, s.units_sold_7d DESC
$$;

GRANT EXECUTE ON FUNCTION public.get_oos_last_7_days(uuid)
  TO authenticated, anon;
