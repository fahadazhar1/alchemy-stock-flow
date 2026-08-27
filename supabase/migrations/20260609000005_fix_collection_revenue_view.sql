-- Fix v_collection_revenue: use products.collection_id → collections.name
-- directly instead of the product_collections junction table (not reliably
-- populated). products.collection_id FK is the canonical primary collection
-- set by the shopify sync and is always present when a product has a collection.
CREATE OR REPLACE VIEW public.v_collection_revenue AS
SELECT
  c.name                      AS collection_name,
  oi.product_id,
  oi.order_id,
  oi.quantity * oi.unit_price AS line_revenue,
  oi.quantity,
  o.shopify_created_at        AS order_date,
  o.cancelled_at,
  o.store_id
FROM public.order_items oi
JOIN public.orders      o ON o.id  = oi.order_id
JOIN public.products    p ON p.id  = oi.product_id
JOIN public.collections c ON c.id  = p.collection_id
WHERE p.collection_id IS NOT NULL;
