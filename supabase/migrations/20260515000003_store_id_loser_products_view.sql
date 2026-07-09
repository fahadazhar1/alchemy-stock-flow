-- Add store_id to v_loser_products so hooks can filter server-side
-- store_id appended at end (CREATE OR REPLACE cannot reorder existing columns)
CREATE OR REPLACE VIEW public.v_loser_products AS
SELECT
  p.id AS product_id,
  p.name AS product_name,
  p.sku,
  COALESCE(SUM(v.inventory_quantity), 0) AS total_inventory,
  (CURRENT_DATE - p.created_at::date) AS days_old,
  vn.name AS vendor_name,
  c.name AS collection_name,
  p.store_id
FROM public.products p
LEFT JOIN public.variants v ON v.product_id = p.id
LEFT JOIN public.vendors vn ON vn.id = p.vendor_id
LEFT JOIN public.collections c ON c.id = p.collection_id
GROUP BY p.id, p.name, p.sku, p.created_at, vn.name, c.name, p.store_id
HAVING (CURRENT_DATE - p.created_at::date) > 20
   AND COALESCE(SUM(v.inventory_quantity), 0) > 10;

ALTER VIEW public.v_loser_products SET (security_invoker = on);
