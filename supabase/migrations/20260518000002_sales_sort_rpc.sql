-- RPC for sales sort: store-scoped aggregation of order counts + revenue per product.
-- Called by the collection-sort-manager edge function instead of two raw .select() calls,
-- which were hitting both the PostgREST 1000-row default limit and the nginx 8KB URL limit.
CREATE OR REPLACE FUNCTION get_store_sales_data(
  p_store_id         UUID,
  p_numeric_product_ids TEXT[]
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
  WHERE p.store_id = p_store_id
    AND p.shopify_product_id = ANY(p_numeric_product_ids)
  GROUP BY p.shopify_product_id;
$$;
