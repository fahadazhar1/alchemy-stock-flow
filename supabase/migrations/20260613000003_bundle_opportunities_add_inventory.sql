-- Add product_a_inventory and product_b_inventory to get_bundle_opportunities
DROP FUNCTION IF EXISTS get_bundle_opportunities(uuid, integer);
CREATE OR REPLACE FUNCTION get_bundle_opportunities(
  p_store_id uuid DEFAULT NULL,
  p_min_count int  DEFAULT 3
)
RETURNS TABLE (
  product_a_id             uuid,
  product_a_name           text,
  product_a_sku            text,
  product_a_inventory      bigint,
  product_b_id             uuid,
  product_b_name           text,
  product_b_sku            text,
  product_b_inventory      bigint,
  co_occurrence_count      bigint,
  estimated_bundle_revenue numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pa.id,
    pa.name,
    pa.sku,
    (SELECT COALESCE(SUM(v.inventory_quantity), 0) FROM variants v WHERE v.product_id = pa.id)::bigint,
    pb.id,
    pb.name,
    pb.sku,
    (SELECT COALESCE(SUM(v.inventory_quantity), 0) FROM variants v WHERE v.product_id = pb.id)::bigint,
    COUNT(DISTINCT ia.order_id)::bigint,
    ROUND(AVG(COALESCE(ia.unit_price, 0) + COALESCE(ib.unit_price, 0))::numeric, 2)
  FROM order_items ia
  JOIN order_items ib ON ia.order_id = ib.order_id AND ia.product_id < ib.product_id
  JOIN orders     o  ON o.id = ia.order_id
  JOIN products   pa ON pa.id = ia.product_id
  JOIN products   pb ON pb.id = ib.product_id
  WHERE o.cancelled_at IS NULL
    AND (p_store_id IS NULL OR o.store_id = p_store_id)
    AND o.shopify_created_at >= NOW() - INTERVAL '90 days'
  GROUP BY pa.id, pa.name, pa.sku, pb.id, pb.name, pb.sku
  HAVING COUNT(DISTINCT ia.order_id) >= p_min_count
  ORDER BY COUNT(DISTINCT ia.order_id) DESC
  LIMIT 20;
END;
$$;
