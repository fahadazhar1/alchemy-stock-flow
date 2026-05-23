-- Add p_since parameter to get_store_sales_data so the sales sort
-- can rank by a configurable window (30/60/90 days) instead of all-time history.
-- NULL p_since preserves the previous all-time behaviour (backwards compatible).
CREATE OR REPLACE FUNCTION get_store_sales_data(
  p_store_id            UUID,
  p_numeric_product_ids TEXT[],
  p_since               TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  shopify_product_id TEXT,
  order_count        BIGINT,
  revenue            NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p.shopify_product_id,
    COUNT(*)::BIGINT                                                          AS order_count,
    COALESCE(SUM(oi.quantity::numeric * oi.unit_price::numeric), 0)          AS revenue
  FROM products p
  JOIN order_items oi ON oi.product_id = p.id
  JOIN orders     o  ON o.id = oi.order_id
  WHERE p.store_id = p_store_id
    AND p.shopify_product_id = ANY(p_numeric_product_ids)
    AND o.cancelled_at IS NULL
    AND (p_since IS NULL OR o.shopify_created_at >= p_since)
  GROUP BY p.shopify_product_id;
$$;
