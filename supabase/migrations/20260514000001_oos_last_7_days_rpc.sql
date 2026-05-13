-- ── get_oos_last_7_days ───────────────────────────────────────────────────────
-- Returns products that are currently out of stock AND had sales in the
-- last 7 days (proving they were in stock during that window).
--
-- initial_inventory is estimated as units_sold because current = 0, so the
-- minimum opening stock that explains observed sales is equal to sales.
--
-- Parameters:
--   p_store_id – optional store filter (NULL = all stores)

CREATE OR REPLACE FUNCTION public.get_oos_last_7_days(
  p_store_id uuid DEFAULT NULL
)
RETURNS TABLE (
  product_id        uuid,
  name              text,
  sku               text,
  price             numeric,
  initial_inventory bigint,
  sales_last_7d     bigint,
  current_inventory bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH
  sales AS (
    SELECT
      oi.product_id,
      SUM(oi.quantity)::bigint AS units_sold
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
    p.id                       AS product_id,
    p.name                     AS name,
    p.sku                      AS sku,
    pi.min_price               AS price,
    COALESCE(s.units_sold, 0)  AS initial_inventory,
    COALESCE(s.units_sold, 0)  AS sales_last_7d,
    pi.total_inv               AS current_inventory
  FROM public.products   p
  JOIN product_inv       pi ON pi.product_id = p.id
  JOIN sales             s  ON s.product_id  = p.id
  WHERE pi.total_inv = 0
  ORDER BY s.units_sold DESC
$$;

GRANT EXECUTE ON FUNCTION public.get_oos_last_7_days(uuid)
  TO authenticated, anon;

CREATE INDEX IF NOT EXISTS idx_order_items_product_id
  ON public.order_items (product_id);
