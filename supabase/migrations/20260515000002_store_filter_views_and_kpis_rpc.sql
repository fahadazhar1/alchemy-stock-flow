-- Add store_id to v_product_inventory_summary so hooks can filter by store
-- store_id is appended at the end (CREATE OR REPLACE cannot reorder existing columns)
CREATE OR REPLACE VIEW public.v_product_inventory_summary AS
SELECT
  p.id AS product_id,
  p.name AS product_name,
  p.sku,
  v_agg.vendor_name,
  c.name AS collection_name,
  p.product_type,
  COALESCE(v_agg.total_inventory, 0) AS total_inventory,
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
    SUM(va.inventory_quantity) AS total_inventory,
    MIN(va.price) AS min_current_price,
    MAX(va.compare_at_price) AS max_compare_at_price,
    MAX(va.campaign_name) AS campaign_name,
    MIN(va.expiry_date) AS nearest_expiry_date,
    bool_or(va.compare_at_price IS NOT NULL AND va.compare_at_price > 0) AS has_discount,
    vn.name AS vendor_name
  FROM public.variants va
  LEFT JOIN public.vendors vn ON vn.id = p.vendor_id
  WHERE va.product_id = p.id
  GROUP BY vn.name
) v_agg ON true;

ALTER VIEW public.v_product_inventory_summary SET (security_invoker = on);

-- Add store_id to v_replenishment_candidates so hooks can filter by store
-- store_id is appended at the end (CREATE OR REPLACE cannot reorder existing columns)
CREATE OR REPLACE VIEW public.v_replenishment_candidates AS
SELECT
  p.id AS product_id,
  p.name AS product_name,
  p.sku,
  COALESCE(SUM(v.inventory_quantity - v.committed_quantity), 0) AS available_units,
  COALESCE(pvm.units_sold_7d, 0) AS velocity,
  CASE
    WHEN COALESCE(SUM(v.inventory_quantity - v.committed_quantity), 0) = 0 THEN 'Out of Stock'
    WHEN COALESCE(SUM(v.inventory_quantity - v.committed_quantity), 0) < 5 THEN 'Replenish Now'
    WHEN COALESCE(SUM(v.inventory_quantity - v.committed_quantity), 0) < 15 THEN 'Low Stock Winner'
    ELSE 'Watch Closely'
  END AS replenishment_status,
  p.store_id
FROM public.products p
LEFT JOIN public.variants v ON v.product_id = p.id
LEFT JOIN public.product_velocity_metrics pvm ON pvm.product_id = p.id
WHERE NOT (
  (CURRENT_DATE - p.created_at::date) > 20
  AND COALESCE((SELECT SUM(v2.inventory_quantity) FROM public.variants v2 WHERE v2.product_id = p.id), 0) > 10
)
GROUP BY p.id, p.name, p.sku, p.store_id, pvm.units_sold_7d
HAVING COALESCE(SUM(v.inventory_quantity - v.committed_quantity), 0) < 20;

ALTER VIEW public.v_replenishment_candidates SET (security_invoker = on);

-- RPC replacing v_dashboard_kpis so callers can pass an optional store filter
CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_store_id uuid DEFAULT NULL)
RETURNS TABLE(
  on_hand_inventory         bigint,
  available_units           bigint,
  pending_order_inventory   bigint,
  sell_through_ratio_current_month numeric,
  out_of_stock_products     bigint,
  collections_count         bigint,
  vendors_count             bigint,
  losers_count              bigint,
  winners_count             bigint,
  near_expiry_products_count bigint,
  low_stock_winners_count   bigint,
  campaigns_running_count   bigint,
  pending_approvals_count   bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH variant_stats AS (
    SELECT
      COALESCE(SUM(va.inventory_quantity), 0)::bigint                          AS on_hand_inventory,
      COALESCE(SUM(va.inventory_quantity - va.committed_quantity), 0)::bigint  AS available_units
    FROM public.variants va
    JOIN public.products pr ON pr.id = va.product_id
    WHERE (p_store_id IS NULL OR pr.store_id = p_store_id)
  ),
  pending_orders AS (
    SELECT COALESCE(SUM(oi.quantity), 0)::bigint AS pending_order_inventory
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.status IN ('pending', 'unfulfilled')
      AND (p_store_id IS NULL OR o.store_id = p_store_id)
  ),
  current_month_sales AS (
    SELECT COALESCE(SUM(oi.quantity), 0)::bigint AS fulfilled_units
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.status = 'fulfilled'
      AND date_trunc('month', o.created_at) = date_trunc('month', now())
      AND (p_store_id IS NULL OR o.store_id = p_store_id)
  ),
  oos AS (
    SELECT COUNT(*)::bigint AS out_of_stock_products
    FROM public.products p
    WHERE (p_store_id IS NULL OR p.store_id = p_store_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.variants v WHERE v.product_id = p.id AND v.inventory_quantity > 0
      )
  ),
  loser_calc AS (
    SELECT COUNT(*)::bigint AS losers_count
    FROM public.products p
    WHERE (p_store_id IS NULL OR p.store_id = p_store_id)
      AND (CURRENT_DATE - p.created_at::date) > 20
      AND COALESCE((SELECT SUM(v.inventory_quantity) FROM public.variants v WHERE v.product_id = p.id), 0) > 10
  ),
  winner_calc AS (
    SELECT COUNT(*)::bigint AS winners_count
    FROM public.products p
    WHERE (p_store_id IS NULL OR p.store_id = p_store_id)
      AND NOT (
        (CURRENT_DATE - p.created_at::date) > 20
        AND COALESCE((SELECT SUM(v.inventory_quantity) FROM public.variants v WHERE v.product_id = p.id), 0) > 10
      )
  ),
  near_expiry AS (
    SELECT COUNT(DISTINCT va.product_id)::bigint AS near_expiry_products_count
    FROM public.variants va
    JOIN public.products pr ON pr.id = va.product_id
    WHERE va.expiry_date IS NOT NULL
      AND va.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
      AND va.expiry_date >= CURRENT_DATE
      AND (p_store_id IS NULL OR pr.store_id = p_store_id)
  ),
  low_stock_winners AS (
    SELECT COUNT(*)::bigint AS low_stock_winners_count
    FROM public.products p
    WHERE (p_store_id IS NULL OR p.store_id = p_store_id)
      AND NOT (
        (CURRENT_DATE - p.created_at::date) > 20
        AND COALESCE((SELECT SUM(v.inventory_quantity) FROM public.variants v WHERE v.product_id = p.id), 0) > 10
      )
      AND COALESCE((SELECT SUM(v.inventory_quantity - v.committed_quantity) FROM public.variants v WHERE v.product_id = p.id), 0) < 10
      AND COALESCE((SELECT SUM(v.inventory_quantity - v.committed_quantity) FROM public.variants v WHERE v.product_id = p.id), 0) > 0
  ),
  campaigns_running AS (
    SELECT COUNT(*)::bigint AS campaigns_running_count
    FROM public.pricing_campaigns
    WHERE workflow_status IN ('Approved', 'Executed')
      AND (ended_at IS NULL OR ended_at > now())
      AND (p_store_id IS NULL OR store_id = p_store_id)
  ),
  pending_approvals AS (
    SELECT COUNT(*)::bigint AS pending_approvals_count
    FROM public.pricing_campaigns
    WHERE workflow_status = 'Pending Approval'
      AND (p_store_id IS NULL OR store_id = p_store_id)
  )
  SELECT
    vs.on_hand_inventory,
    vs.available_units,
    po.pending_order_inventory,
    CASE
      WHEN (vs.on_hand_inventory + cms.fulfilled_units) > 0
      THEN ROUND((cms.fulfilled_units::numeric / (vs.on_hand_inventory + cms.fulfilled_units)::numeric) * 100, 1)
      ELSE 0
    END AS sell_through_ratio_current_month,
    oos.out_of_stock_products,
    (SELECT COUNT(*) FROM public.collections)::bigint AS collections_count,
    (SELECT COUNT(*) FROM public.vendors)::bigint AS vendors_count,
    lc.losers_count,
    wc.winners_count,
    ne.near_expiry_products_count,
    lsw.low_stock_winners_count,
    cr.campaigns_running_count,
    pa.pending_approvals_count
  FROM variant_stats vs, pending_orders po, current_month_sales cms, oos, loser_calc lc,
       winner_calc wc, near_expiry ne, low_stock_winners lsw, campaigns_running cr, pending_approvals pa;
END;
$$;
