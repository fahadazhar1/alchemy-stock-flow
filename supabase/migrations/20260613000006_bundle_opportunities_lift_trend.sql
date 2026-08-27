-- Rebuild get_bundle_opportunities with lift, confidence A→B, and trend (current vs prev half-window)
-- Lift = (pair_count * total_orders) / (orders_with_a * orders_with_b)
-- Confidence A→B = pair_count / orders_with_a  (expressed as %)
-- Trend = split window into two equal halves and count co-buys in each
DROP FUNCTION IF EXISTS get_bundle_opportunities(uuid, integer);
CREATE OR REPLACE FUNCTION get_bundle_opportunities(
  p_store_id uuid DEFAULT NULL,
  p_min_count int  DEFAULT 3,
  p_days      int  DEFAULT 90
)
RETURNS TABLE (
  product_a_id             uuid,
  product_a_name           text,
  product_a_sku            text,
  product_a_inventory      bigint,
  product_a_price          numeric,
  product_b_id             uuid,
  product_b_name           text,
  product_b_sku            text,
  product_b_inventory      bigint,
  product_b_price          numeric,
  co_occurrence_count      bigint,
  estimated_bundle_revenue numeric,
  lift                     numeric,
  confidence_a_to_b        numeric,
  current_half_count       bigint,
  prev_half_count          bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_window_start timestamptz := NOW() - (p_days || ' days')::interval;
  v_half_point   timestamptz := NOW() - ((p_days / 2) || ' days')::interval;
BEGIN
  RETURN QUERY
  WITH
  total AS (
    SELECT COUNT(*)::numeric AS n
    FROM orders
    WHERE cancelled_at IS NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
      AND shopify_created_at >= v_window_start
  ),
  product_order_counts AS (
    SELECT oi.product_id, COUNT(DISTINCT oi.order_id)::numeric AS n
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.cancelled_at IS NULL
      AND (p_store_id IS NULL OR o.store_id = p_store_id)
      AND o.shopify_created_at >= v_window_start
    GROUP BY oi.product_id
  )
  SELECT
    pa.id,
    pa.name,
    pa.sku,
    (SELECT COALESCE(SUM(v.inventory_quantity), 0) FROM variants v WHERE v.product_id = pa.id)::bigint,
    (SELECT COALESCE(MIN(v.price), 0)             FROM variants v WHERE v.product_id = pa.id),
    pb.id,
    pb.name,
    pb.sku,
    (SELECT COALESCE(SUM(v.inventory_quantity), 0) FROM variants v WHERE v.product_id = pb.id)::bigint,
    (SELECT COALESCE(MIN(v.price), 0)             FROM variants v WHERE v.product_id = pb.id),
    COUNT(DISTINCT ia.order_id)::bigint                                                AS co_occurrence_count,
    ROUND(AVG(COALESCE(ia.unit_price, 0) + COALESCE(ib.unit_price, 0))::numeric, 2)  AS estimated_bundle_revenue,
    CASE
      WHEN poc_a.n > 0 AND poc_b.n > 0 AND t.n > 0
      THEN ROUND((COUNT(DISTINCT ia.order_id)::numeric * t.n) / (poc_a.n * poc_b.n), 2)
      ELSE NULL
    END                                                                                AS lift,
    CASE
      WHEN poc_a.n > 0
      THEN ROUND((COUNT(DISTINCT ia.order_id)::numeric / poc_a.n) * 100, 1)
      ELSE NULL
    END                                                                                AS confidence_a_to_b,
    COUNT(DISTINCT CASE WHEN o.shopify_created_at >= v_half_point THEN ia.order_id END)::bigint AS current_half_count,
    COUNT(DISTINCT CASE WHEN o.shopify_created_at <  v_half_point THEN ia.order_id END)::bigint AS prev_half_count
  FROM order_items ia
  JOIN order_items ib      ON ia.order_id   = ib.order_id AND ia.product_id < ib.product_id
  JOIN orders     o        ON o.id          = ia.order_id
  JOIN products   pa       ON pa.id         = ia.product_id
  JOIN products   pb       ON pb.id         = ib.product_id
  JOIN product_order_counts poc_a ON poc_a.product_id = ia.product_id
  JOIN product_order_counts poc_b ON poc_b.product_id = ib.product_id
  CROSS JOIN total t
  WHERE o.cancelled_at IS NULL
    AND (p_store_id IS NULL OR o.store_id = p_store_id)
    AND o.shopify_created_at >= v_window_start
  GROUP BY pa.id, pa.name, pa.sku, pb.id, pb.name, pb.sku, poc_a.n, poc_b.n, t.n
  HAVING COUNT(DISTINCT ia.order_id) >= p_min_count
  ORDER BY
    CASE
      WHEN poc_a.n > 0 AND poc_b.n > 0 AND t.n > 0
      THEN (COUNT(DISTINCT ia.order_id)::numeric * t.n) / (poc_a.n * poc_b.n)
      ELSE 0
    END DESC,
    COUNT(DISTINCT ia.order_id) DESC
  LIMIT 30;
END;
$$;
