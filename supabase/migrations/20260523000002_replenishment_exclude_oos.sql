-- Fix replenishment queue: exclude already-OOS products, focus on products with stock but selling fast.
DROP VIEW IF EXISTS public.v_replenishment_candidates;
CREATE VIEW public.v_replenishment_candidates AS
SELECT
  p.id AS product_id,
  p.name AS product_name,
  p.sku,
  COALESCE(SUM(v.inventory_quantity - v.committed_quantity), 0) AS available_units,
  COALESCE(pvm.units_sold_7d, 0) AS velocity,
  ROUND(
    (COALESCE(SUM(v.inventory_quantity - v.committed_quantity), 0)
    / (pvm.units_sold_7d::float / 7.0))::numeric,
  1) AS days_of_stock,
  CASE
    WHEN COALESCE(SUM(v.inventory_quantity - v.committed_quantity), 0)
         / (pvm.units_sold_7d::float / 7.0) < 3
      THEN 'Critical'
    WHEN COALESCE(SUM(v.inventory_quantity - v.committed_quantity), 0)
         / (pvm.units_sold_7d::float / 7.0) < 7
      THEN 'Replenish Now'
    WHEN COALESCE(SUM(v.inventory_quantity - v.committed_quantity), 0)
         / (pvm.units_sold_7d::float / 7.0) < 14
      THEN 'Low Stock'
    ELSE 'Watch Closely'
  END AS replenishment_status,
  p.store_id
FROM public.products p
LEFT JOIN public.variants v ON v.product_id = p.id
LEFT JOIN public.product_velocity_metrics pvm ON pvm.product_id = p.id
WHERE p.status = 'active'
GROUP BY p.id, p.name, p.sku, p.store_id, pvm.units_sold_7d
HAVING (
  COALESCE(pvm.units_sold_7d, 0) > 0
  AND COALESCE(SUM(v.inventory_quantity - v.committed_quantity), 0) > 0
  AND COALESCE(SUM(v.inventory_quantity - v.committed_quantity), 0)
      / (pvm.units_sold_7d::float / 7.0) < 30
);

ALTER VIEW public.v_replenishment_candidates SET (security_invoker = on);
