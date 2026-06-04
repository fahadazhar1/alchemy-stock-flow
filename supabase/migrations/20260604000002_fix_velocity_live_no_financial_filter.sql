-- Fix: match refreshVelocityMetrics() exactly — only filter cancelled_at IS NULL,
-- no financial_status restriction (sync counts pending/authorized orders too).

CREATE OR REPLACE VIEW public.v_product_velocity_live AS
SELECT
  oi.product_id,
  p.name,
  p.sku,
  p.store_id,
  SUM(CASE WHEN o.shopify_created_at >= NOW() - INTERVAL '7 days'  THEN oi.quantity ELSE 0 END)::integer AS units_sold_7d,
  SUM(CASE WHEN o.shopify_created_at >= NOW() - INTERVAL '14 days' THEN oi.quantity ELSE 0 END)::integer AS units_sold_14d,
  SUM(CASE WHEN o.shopify_created_at >= NOW() - INTERVAL '30 days' THEN oi.quantity ELSE 0 END)::integer AS units_sold_30d,
  MAX(o.shopify_created_at) AS last_sale_at,
  COALESCE(inv.total_inventory, 0)::integer  AS total_inventory,
  COALESCE(inv.available_units, 0)::integer  AS available_units
FROM public.order_items oi
JOIN public.orders   o ON o.id  = oi.order_id
JOIN public.products p ON p.id  = oi.product_id
LEFT JOIN (
  SELECT
    product_id,
    SUM(inventory_quantity)::integer                                   AS total_inventory,
    SUM(inventory_quantity - COALESCE(committed_quantity, 0))::integer AS available_units
  FROM public.variants
  GROUP BY product_id
) inv ON inv.product_id = p.id
WHERE o.cancelled_at IS NULL
  AND o.shopify_created_at >= NOW() - INTERVAL '30 days'
GROUP BY oi.product_id, p.name, p.sku, p.store_id, p.id, inv.total_inventory, inv.available_units;

GRANT SELECT ON public.v_product_velocity_live TO anon, authenticated;
