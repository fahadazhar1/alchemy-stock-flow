-- get_top_products only excluded fully 'refunded' orders, so partially_refunded
-- orders were still counted at their full original quantity/price — inflating
-- revenue/units for products that had significant partial returns.
--
-- There's no per-line refund-amount column (only order-level financial_status),
-- so match the same approximation already used elsewhere in this codebase
-- (get_store_sales_metrics, get_store_daily_channel_sales): exclude the whole
-- order from revenue when it's refunded OR partially_refunded.

CREATE OR REPLACE FUNCTION public.get_top_products(
  p_start_iso       timestamptz,
  p_end_iso         timestamptz,
  p_prev_start_iso  timestamptz,
  p_prev_end_iso    timestamptz,
  p_limit           int  DEFAULT 6,
  p_store_id        uuid DEFAULT NULL
)
RETURNS TABLE (
  product_id  uuid,
  name        text,
  sku         text,
  vendor      text,
  units       numeric,
  revenue     numeric,
  trend       numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH cur_orders AS (
    SELECT id FROM public.orders
    WHERE shopify_created_at >= p_start_iso
      AND shopify_created_at <= p_end_iso
      AND cancelled_at IS NULL
      AND financial_status NOT IN ('refunded', 'partially_refunded')
      AND (p_store_id IS NULL OR store_id = p_store_id)
  ),
  prev_orders AS (
    SELECT id FROM public.orders
    WHERE shopify_created_at >= p_prev_start_iso
      AND shopify_created_at <= p_prev_end_iso
      AND cancelled_at IS NULL
      AND financial_status NOT IN ('refunded', 'partially_refunded')
      AND (p_store_id IS NULL OR store_id = p_store_id)
  ),
  cur_agg AS (
    SELECT
      oi.product_id,
      SUM(COALESCE(oi.quantity, 0))                          AS units,
      SUM(COALESCE(oi.quantity, 0) * COALESCE(oi.unit_price, 0)) AS revenue
    FROM public.order_items oi
    JOIN cur_orders co ON co.id = oi.order_id
    GROUP BY oi.product_id
  ),
  prev_agg AS (
    SELECT
      oi.product_id,
      SUM(COALESCE(oi.quantity, 0) * COALESCE(oi.unit_price, 0)) AS revenue
    FROM public.order_items oi
    JOIN prev_orders po ON po.id = oi.order_id
    GROUP BY oi.product_id
  ),
  top AS (
    SELECT * FROM cur_agg
    ORDER BY revenue DESC, product_id
    LIMIT p_limit
  )
  SELECT
    t.product_id,
    COALESCE(p.name, '—')                          AS name,
    COALESCE(p.sku, '—')                           AS sku,
    COALESCE(v.name, p.product_type, '—')          AS vendor,
    t.units::numeric                               AS units,
    t.revenue::numeric                             AS revenue,
    CASE
      WHEN COALESCE(pa.revenue, 0) > 0
      THEN ROUND(((t.revenue - pa.revenue) / pa.revenue) * 100)
      ELSE NULL
    END                                            AS trend
  FROM top t
  LEFT JOIN public.products p  ON p.id = t.product_id
  LEFT JOIN public.vendors  v  ON v.id = p.vendor_id
  LEFT JOIN prev_agg        pa ON pa.product_id = t.product_id
  ORDER BY t.revenue DESC, t.product_id
$$;

GRANT EXECUTE ON FUNCTION public.get_top_products(timestamptz, timestamptz, timestamptz, timestamptz, int, uuid)
  TO authenticated, anon;
