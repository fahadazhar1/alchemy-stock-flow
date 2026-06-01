-- Add units_sold to get_store_sales_data so the sales sort can rank by total quantity sold.

DROP FUNCTION IF EXISTS get_store_sales_data(UUID, TEXT[], TIMESTAMPTZ);

CREATE FUNCTION get_store_sales_data(
  p_store_id            UUID,
  p_numeric_product_ids TEXT[],
  p_since               TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  shopify_product_id TEXT,
  order_count        BIGINT,
  units_sold         BIGINT,
  revenue            NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p.shopify_product_id,
    COUNT(*)::BIGINT                                                 AS order_count,
    COALESCE(SUM(oi.quantity), 0)::BIGINT                           AS units_sold,
    COALESCE(SUM(oi.quantity::numeric * oi.unit_price::numeric), 0) AS revenue
  FROM products p
  JOIN order_items oi ON oi.product_id = p.id
  JOIN orders     o  ON o.id = oi.order_id
  WHERE p.store_id = p_store_id
    AND p.shopify_product_id = ANY(p_numeric_product_ids)
    AND o.cancelled_at IS NULL
    AND (p_since IS NULL OR o.shopify_created_at >= p_since)
  GROUP BY p.shopify_product_id;
$$;
