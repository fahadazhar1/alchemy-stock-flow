-- Variant-level replenishment queue.
-- The product-level view sums stock across variants, so a product with 5 variants x 5 units
-- (25 total) never qualified even when one variant was about to run out. This view applies the
-- same criteria per variant: active product, stock > 0, sold in the last 7 days (that variant),
-- days of stock < 30. Velocity is read from order_items.variant_id over non-cancelled orders.
CREATE OR REPLACE VIEW public.v_replenishment_variant_candidates AS
WITH sold AS (
  SELECT oi.variant_id, SUM(oi.quantity)::int AS units_7d
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.cancelled_at IS NULL
    AND o.shopify_created_at >= now() - interval '7 days'
    AND oi.variant_id IS NOT NULL
  GROUP BY oi.variant_id
), base AS (
  SELECT
    p.id AS product_id,
    v.id AS variant_id,
    p.name AS product_name,
    NULLIF(v.size, 'Default Title') AS variant_title,
    COALESCE(NULLIF(v.variant_sku, ''), p.sku) AS sku,
    (v.inventory_quantity - v.committed_quantity) AS available_units,
    s.units_7d AS velocity,
    (v.inventory_quantity - v.committed_quantity) / (s.units_7d::float / 7.0) AS dos,
    (SELECT count(*) FROM public.variants v2 WHERE v2.product_id = p.id) AS variant_count,
    p.store_id
  FROM public.variants v
  JOIN public.products p ON p.id = v.product_id
  JOIN sold s ON s.variant_id = v.id
  WHERE p.status = 'active'
    AND s.units_7d > 0
    AND (v.inventory_quantity - v.committed_quantity) > 0
)
SELECT
  product_id, variant_id, product_name, variant_title, variant_count::int, sku,
  available_units, velocity,
  ROUND(dos::numeric, 1) AS days_of_stock,
  CASE WHEN dos < 3 THEN 'Critical'
       WHEN dos < 7 THEN 'Replenish Now'
       WHEN dos < 14 THEN 'Low Stock'
       ELSE 'Watch Closely' END AS replenishment_status,
  store_id
FROM base
WHERE dos < 30;

ALTER VIEW public.v_replenishment_variant_candidates SET (security_invoker = on);
GRANT SELECT ON public.v_replenishment_variant_candidates TO authenticated, anon;
