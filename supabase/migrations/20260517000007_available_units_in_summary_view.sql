-- Add available_units to v_product_inventory_summary
-- Must DROP first — PostgreSQL won't let CREATE OR REPLACE add a column mid-list
DROP VIEW IF EXISTS public.v_product_inventory_summary;

-- Add available_units to v_product_inventory_summary
-- available = inventory_quantity - committed_quantity (Shopify Phase 2 stores available in inventory_quantity,
-- committed_quantity tracks reserved orders; default 0 if not synced)
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
  p.store_id
FROM public.products p
LEFT JOIN public.collections c ON c.id = p.collection_id
LEFT JOIN LATERAL (
  SELECT
    SUM(va.inventory_quantity)                                               AS total_inventory,
    SUM(COALESCE(va.committed_quantity, 0))                                  AS total_committed,
    MIN(va.price)                                                            AS min_current_price,
    MAX(va.compare_at_price)                                                 AS max_compare_at_price,
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
