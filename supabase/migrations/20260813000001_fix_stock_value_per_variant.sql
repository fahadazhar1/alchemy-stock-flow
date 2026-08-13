-- Fix: v_product_inventory_summary computed stock value as total_inventory * min_current_price,
-- which undervalues any multi-variant product where variants have different prices
-- (total inventory across ALL variants gets priced at the CHEAPEST variant's price).
-- Add a correctly per-variant-weighted total_stock_value column instead.
-- Appended at the end (not DROP+recreate) — v_seo_audit depends on this view and CREATE OR REPLACE
-- only allows adding columns at the end of the list, not mid-list.
CREATE OR REPLACE VIEW public.v_product_inventory_summary AS
SELECT
  p.id AS product_id,
  p.name AS product_name,
  p.sku,
  v_agg.vendor_name,
  c.name AS collection_name,
  p.product_type,
  COALESCE(v_agg.total_inventory, 0) AS total_inventory,
  GREATEST(COALESCE(v_agg.total_inventory, 0) - COALESCE(v_agg.total_committed, 0), 0) AS available_units,
  v_agg.min_current_price,
  v_agg.max_compare_at_price,
  v_agg.campaign_name,
  (CURRENT_DATE - p.created_at::date) AS days_old,
  CASE WHEN v_agg.has_discount THEN 'discounted' ELSE 'active' END AS discount_status,
  v_agg.nearest_expiry_date,
  CASE
    WHEN v_agg.nearest_expiry_date IS NULL THEN 'No Expiry'
    WHEN v_agg.nearest_expiry_date < CURRENT_DATE THEN 'Expired'
    WHEN v_agg.nearest_expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'Expiring Soon'
    ELSE 'Healthy Shelf Life'
  END AS near_expiry_status,
  p.status AS product_status,
  p.created_at,
  p.store_id,
  COALESCE(v_agg.total_stock_value, 0) AS total_stock_value
FROM public.products p
LEFT JOIN public.collections c ON c.id = p.collection_id
LEFT JOIN LATERAL (
  SELECT
    SUM(va.inventory_quantity)                                               AS total_inventory,
    SUM(COALESCE(va.committed_quantity, 0))                                  AS total_committed,
    MIN(va.price)                                                            AS min_current_price,
    MAX(va.compare_at_price)                                                 AS max_compare_at_price,
    SUM(va.inventory_quantity * va.price)                                    AS total_stock_value,
    MAX(va.campaign_name)                                                    AS campaign_name,
    MIN(va.expiry_date)                                                      AS nearest_expiry_date,
    bool_or(va.compare_at_price IS NOT NULL AND va.compare_at_price > 0)    AS has_discount,
    vn.name                                                                  AS vendor_name
  FROM public.variants va
  LEFT JOIN public.vendors vn ON vn.id = p.vendor_id
  WHERE va.product_id = p.id
  GROUP BY vn.name
) v_agg ON true;

ALTER VIEW public.v_product_inventory_summary SET (security_invoker = on);
