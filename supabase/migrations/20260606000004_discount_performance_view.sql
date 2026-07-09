-- v_discount_performance: daily breakdown of orders with/without discounts
CREATE OR REPLACE VIEW v_discount_performance AS
SELECT
  DATE_TRUNC('day', shopify_created_at)::date             AS sale_date,
  store_id,
  COUNT(*)                                                 AS total_orders,
  COUNT(*) FILTER (WHERE total_discounts > 0)              AS discounted_orders,
  COUNT(*) FILTER (WHERE COALESCE(total_discounts, 0) = 0) AS full_price_orders,
  COALESCE(SUM(total_discounts), 0)                        AS total_discount_amount,
  COALESCE(AVG(total_price) FILTER (WHERE total_discounts > 0), 0)              AS avg_discounted_aov,
  COALESCE(AVG(total_price) FILTER (WHERE COALESCE(total_discounts, 0) = 0), 0) AS avg_full_price_aov,
  COALESCE(SUM(total_price) FILTER (WHERE total_discounts > 0), 0)              AS discounted_revenue,
  COALESCE(SUM(total_price) FILTER (WHERE COALESCE(total_discounts, 0) = 0), 0) AS full_price_revenue
FROM orders
WHERE cancelled_at IS NULL
  AND shopify_created_at IS NOT NULL
GROUP BY DATE_TRUNC('day', shopify_created_at)::date, store_id
ORDER BY sale_date DESC;
