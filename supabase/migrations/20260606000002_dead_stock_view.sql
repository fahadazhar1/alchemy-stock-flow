-- v_dead_stock: active products with inventory but no sales in last 30 days
CREATE OR REPLACE VIEW v_dead_stock AS
WITH sales AS (
  SELECT
    oi.product_id,
    MAX(o.shopify_created_at) AS last_sale_at,
    SUM(CASE WHEN o.shopify_created_at >= NOW() - INTERVAL '30 days' THEN oi.quantity ELSE 0 END)::int AS units_sold_30d,
    SUM(CASE WHEN o.shopify_created_at >= NOW() - INTERVAL '60 days' THEN oi.quantity ELSE 0 END)::int AS units_sold_60d,
    SUM(CASE WHEN o.shopify_created_at >= NOW() - INTERVAL '90 days' THEN oi.quantity ELSE 0 END)::int AS units_sold_90d
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE o.cancelled_at IS NULL
  GROUP BY oi.product_id
),
inv AS (
  SELECT
    p.id            AS product_id,
    p.name          AS product_name,
    p.sku,
    p.product_type,
    p.store_id,
    COALESCE(SUM(v.inventory_quantity), 0)::int                          AS total_units,
    COALESCE(MIN(NULLIF(v.price, 0)), 0)                                 AS unit_price,
    COALESCE(SUM(v.inventory_quantity * COALESCE(v.price, 0)), 0)        AS inventory_value
  FROM products p
  JOIN variants v ON v.product_id = p.id
  WHERE p.status = 'active'
  GROUP BY p.id, p.name, p.sku, p.product_type, p.store_id
  HAVING COALESCE(SUM(v.inventory_quantity), 0) > 0
)
SELECT
  i.product_id,
  i.product_name,
  i.sku,
  i.product_type,
  i.store_id,
  i.total_units,
  i.unit_price,
  i.inventory_value,
  s.last_sale_at,
  COALESCE(s.units_sold_30d, 0) AS units_sold_30d,
  COALESCE(s.units_sold_60d, 0) AS units_sold_60d,
  COALESCE(s.units_sold_90d, 0) AS units_sold_90d,
  CASE
    WHEN s.product_id IS NULL             THEN 'Never Sold'
    WHEN COALESCE(s.units_sold_90d, 0) = 0 THEN 'Dead 90d'
    WHEN COALESCE(s.units_sold_60d, 0) = 0 THEN 'Dead 60d'
    ELSE                                       'Dead 30d'
  END AS dead_stock_status
FROM inv i
LEFT JOIN sales s ON s.product_id = i.product_id
WHERE s.product_id IS NULL
   OR COALESCE(s.units_sold_30d, 0) = 0;
