-- ── get_top_products ──────────────────────────────────────────────────────────
-- Server-side aggregation for the useTopProducts hook (Top selling products).
--
-- Replaces this client-side pipeline:
--   1. fetch ≤10k current-period order ids
--   2. fetch ≤10k previous-period order ids
--   3. chunk-fetch order_items (+product+vendor join) for current orders
--   4. chunk-fetch order_items for previous orders
--   5. aggregate per product in JS, sort by revenue, slice top N, compute trend
-- with a single set-based query. Browser receives `p_limit` rows (default 6)
-- instead of potentially tens of thousands of order_items rows. Pure read-only.
--
-- Faithful-replication notes vs the old JS:
--  • Order filter is IDENTICAL to the old PostgREST query:
--      cancelled_at IS NULL AND financial_status <> 'refunded'
--    NOTE: `<> 'refunded'` excludes rows where financial_status IS NULL — this
--    matches PostgREST's .neq() behaviour exactly (NULL is filtered out), so we
--    deliberately do NOT use IS DISTINCT FROM here.
--  • revenue  = SUM(quantity * unit_price)   (matches qty*unit_price per row)
--  • units    = SUM(quantity)
--  • name/sku = COALESCE(products.name/sku, '—')
--  • vendor   = COALESCE(vendors.name, products.product_type, '—')
--  • trend    = prev_revenue > 0 ? ROUND((rev - prev)/prev * 100) : NULL
--  • Sort by revenue DESC, then product_id for a STABLE tie-break. The old JS
--    broke ties by Map insertion order (first appearance in the item fetch);
--    at the top-N boundary an exact revenue tie could pick a different product.
--    Ties at the cutoff are rare; both orderings are "correct top-by-revenue".
--  • quantity/unit_price are NOT NULL in schema; COALESCE kept for parity only.
--  • No .limit cap on the scan (user-approved).

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
      AND financial_status <> 'refunded'
      AND (p_store_id IS NULL OR store_id = p_store_id)
  ),
  prev_orders AS (
    SELECT id FROM public.orders
    WHERE shopify_created_at >= p_prev_start_iso
      AND shopify_created_at <= p_prev_end_iso
      AND cancelled_at IS NULL
      AND financial_status <> 'refunded'
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
