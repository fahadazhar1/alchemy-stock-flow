-- Returns orders where two specific products were bought together
CREATE OR REPLACE FUNCTION get_bundle_order_details(
  p_product_a_id uuid,
  p_product_b_id uuid,
  p_store_id     uuid DEFAULT NULL,
  p_limit        int  DEFAULT 10
)
RETURNS TABLE (
  order_number   text,
  ordered_at     timestamptz,
  customer_email text,
  order_total    numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.order_number,
    o.shopify_created_at,
    o.customer_email,
    o.total_price
  FROM order_items ia
  JOIN order_items ib ON ia.order_id = ib.order_id
  JOIN orders o ON o.id = ia.order_id
  WHERE ia.product_id = p_product_a_id
    AND ib.product_id = p_product_b_id
    AND o.cancelled_at IS NULL
    AND (p_store_id IS NULL OR o.store_id = p_store_id)
    AND o.shopify_created_at >= NOW() - INTERVAL '90 days'
  ORDER BY o.shopify_created_at DESC
  LIMIT p_limit;
END;
$$;
