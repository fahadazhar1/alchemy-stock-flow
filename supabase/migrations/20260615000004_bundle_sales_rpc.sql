-- ── get_bundle_sales ──────────────────────────────────────────────────────────
-- Server-side aggregation for the useBundleSales hook (Bundle vs Others KPI).
--
-- Replaces up to 2× 10k-row fetches from v_order_product_revenue (current + prev
-- period) + JS aggregation with a single set-based query returning 5 numbers.
-- Pure read-only.
--
-- Replication notes vs the old JS aggregate():
--  • Reads v_order_product_revenue (same source as the old primary path), so the
--    LEFT JOIN semantics are identical — order_items with no product row appear
--    with product_type NULL and fall into "others".
--  • line_revenue = quantity * unit_price in the view; both NOT NULL, so the old
--    `Number(line_revenue) || qty*price` fallback was a no-op — we use line_revenue.
--  • bundle vs others: lower(product_type) = 'bundle' is bundle; everything else,
--    INCLUDING NULL product_type, is others (matches (product_type ?? '').lower()).
--  • bundle_orders / others_orders = COUNT(DISTINCT order_id) per side. An order
--    with both bundle and non-bundle lines is counted on BOTH sides — identical to
--    the old independent Set<order_id> behaviour (so the two can sum > total orders).
--  • Only prev_bundle_revenue is returned for prev period — the old code computed a
--    full prev split but used only prev.bundleRevenue (for bundleDelta).
--  • totalRevenue / bundleShare / bundleDelta stay in JS (rounding unchanged).
--  • The old order_items fallback (ran only if the view query errored) is dropped:
--    the RPC reads the same view, so the fallback was dead code in practice.
--  • No .limit cap (user-approved).

CREATE OR REPLACE FUNCTION public.get_bundle_sales(
  p_start_iso       timestamptz,
  p_end_iso         timestamptz,
  p_prev_start_iso  timestamptz,
  p_prev_end_iso    timestamptz,
  p_store_id        uuid DEFAULT NULL
)
RETURNS TABLE (
  bundle_revenue       numeric,
  others_revenue       numeric,
  bundle_orders        bigint,
  others_orders        bigint,
  prev_bundle_revenue  numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH cur AS (
    SELECT
      COALESCE(SUM(line_revenue) FILTER (WHERE lower(product_type) = 'bundle'), 0)              AS bundle_revenue,
      COALESCE(SUM(line_revenue) FILTER (WHERE lower(product_type) IS DISTINCT FROM 'bundle'), 0) AS others_revenue,
      COUNT(DISTINCT order_id)   FILTER (WHERE lower(product_type) = 'bundle')                   AS bundle_orders,
      COUNT(DISTINCT order_id)   FILTER (WHERE lower(product_type) IS DISTINCT FROM 'bundle')    AS others_orders
    FROM public.v_order_product_revenue
    WHERE order_date >= p_start_iso
      AND order_date <= p_end_iso
      AND cancelled_at IS NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
  ),
  prev AS (
    SELECT
      COALESCE(SUM(line_revenue) FILTER (WHERE lower(product_type) = 'bundle'), 0) AS bundle_revenue
    FROM public.v_order_product_revenue
    WHERE order_date >= p_prev_start_iso
      AND order_date <= p_prev_end_iso
      AND cancelled_at IS NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
  )
  SELECT
    cur.bundle_revenue::numeric,
    cur.others_revenue::numeric,
    cur.bundle_orders::bigint,
    cur.others_orders::bigint,
    prev.bundle_revenue::numeric AS prev_bundle_revenue
  FROM cur, prev
$$;

GRANT EXECUTE ON FUNCTION public.get_bundle_sales(timestamptz, timestamptz, timestamptz, timestamptz, uuid)
  TO authenticated, anon;
