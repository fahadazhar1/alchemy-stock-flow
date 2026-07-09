-- Fix v_dashboard_kpis: sell-through was always 0 because:
-- 1. status = 'fulfilled' never matched (sync stores financial_status in status column)
-- 2. created_at is DB insertion time, not Shopify order date
-- 3. pending_orders CTE had the same status field bug

CREATE OR REPLACE VIEW public.v_dashboard_kpis AS
WITH variant_stats AS (
  SELECT
    SUM(inventory_quantity) AS on_hand_inventory,
    SUM(inventory_quantity - committed_quantity) AS available_units
  FROM public.variants
),
pending_orders AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS pending_order_inventory
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.fulfillment_status IS NULL
    AND o.financial_status IN ('paid', 'partially_paid')
    AND o.cancelled_at IS NULL
),
current_month_sales AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS fulfilled_units
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.fulfillment_status = 'fulfilled'
    AND o.cancelled_at IS NULL
    AND date_trunc('month', o.shopify_created_at) = date_trunc('month', now())
),
oos AS (
  SELECT COUNT(*) AS out_of_stock_products
  FROM public.products p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.variants v WHERE v.product_id = p.id AND v.inventory_quantity > 0
  )
),
loser_calc AS (
  SELECT COUNT(*) AS losers_count
  FROM public.products p
  WHERE (CURRENT_DATE - p.created_at::date) > 20
    AND COALESCE((SELECT SUM(v.inventory_quantity) FROM public.variants v WHERE v.product_id = p.id), 0) > 10
),
winner_calc AS (
  SELECT COUNT(*) AS winners_count
  FROM public.products p
  WHERE NOT (
    (CURRENT_DATE - p.created_at::date) > 20
    AND COALESCE((SELECT SUM(v.inventory_quantity) FROM public.variants v WHERE v.product_id = p.id), 0) > 10
  )
),
near_expiry AS (
  SELECT COUNT(DISTINCT v.product_id) AS near_expiry_products_count
  FROM public.variants v
  WHERE v.expiry_date IS NOT NULL
    AND v.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
    AND v.expiry_date >= CURRENT_DATE
),
low_stock_winners AS (
  SELECT COUNT(*) AS low_stock_winners_count
  FROM public.products p
  WHERE NOT (
    (CURRENT_DATE - p.created_at::date) > 20
    AND COALESCE((SELECT SUM(v.inventory_quantity) FROM public.variants v WHERE v.product_id = p.id), 0) > 10
  )
  AND COALESCE((SELECT SUM(v.inventory_quantity - v.committed_quantity) FROM public.variants v WHERE v.product_id = p.id), 0) < 10
  AND COALESCE((SELECT SUM(v.inventory_quantity - v.committed_quantity) FROM public.variants v WHERE v.product_id = p.id), 0) > 0
),
campaigns_running AS (
  SELECT COUNT(*) AS campaigns_running_count
  FROM public.pricing_campaigns
  WHERE workflow_status IN ('Approved', 'Executed')
    AND (ended_at IS NULL OR ended_at > now())
),
pending_approvals AS (
  SELECT COUNT(*) AS pending_approvals_count
  FROM public.pricing_campaigns
  WHERE workflow_status = 'Pending Approval'
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
  (SELECT COUNT(*) FROM public.collections) AS collections_count,
  (SELECT COUNT(*) FROM public.vendors) AS vendors_count,
  lc.losers_count,
  wc.winners_count,
  ne.near_expiry_products_count,
  lsw.low_stock_winners_count,
  cr.campaigns_running_count,
  pa.pending_approvals_count
FROM variant_stats vs, pending_orders po, current_month_sales cms, oos, loser_calc lc, winner_calc wc, near_expiry ne, low_stock_winners lsw, campaigns_running cr, pending_approvals pa;
