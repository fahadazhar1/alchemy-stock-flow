-- Fix v_order_product_revenue: use LEFT JOIN on products/vendors so order items
-- without a matching product row still appear (prevents silent 0 on unitsSold).
CREATE OR REPLACE VIEW public.v_order_product_revenue AS
SELECT
  oi.id             AS order_item_id,
  oi.order_id,
  oi.product_id,
  p.name            AS product_name,
  p.sku,
  p.product_type,
  vn.name           AS vendor_name,
  oi.quantity,
  oi.unit_price,
  oi.quantity * oi.unit_price AS line_revenue,
  o.shopify_created_at        AS order_date,
  o.cancelled_at,
  o.source_name,
  o.store_id
FROM public.order_items oi
JOIN  public.orders   o  ON o.id  = oi.order_id
LEFT JOIN public.products p  ON p.id  = oi.product_id
LEFT JOIN public.vendors  vn ON vn.id = p.vendor_id;
