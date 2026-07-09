-- ── get_sales_kpis ────────────────────────────────────────────────────────────
-- Server-side aggregation for the useSalesKPIs hook.
--
-- Replaces two 10k-row raw fetches (current + previous period) and one
-- pending-orders count with a single set of SQL aggregates, so the browser
-- receives ~7 numbers instead of up to 20,000 order rows. Pure read-only.
--
-- The hook still reads v_dashboard_kpis separately for sell_through and
-- pending_approvals (cheap single-row view, unchanged).
--
-- Behaviour notes vs the old JS path:
--  • MTD / prev aggregates filter cancelled_at IS NULL — identical to the JS
--    `.filter(r => !r.cancelled_at)` that ran after each fetch.
--  • pending_orders: financial_status='paid' AND fulfillment_status IS NULL
--    AND cancelled_at IS NULL, NOT date-bounded — identical to the old count query.
--  • The old queries capped at .limit(10000); this function has NO cap, so a
--    period with >10k orders is now counted in full (strictly more accurate).
--  • Derived ratios (aov, refundRate, refundAmountRate, revenueDelta,
--    ordersDelta) are intentionally NOT computed here — the hook keeps doing
--    them in JS so rounding stays bit-identical.

CREATE OR REPLACE FUNCTION public.get_sales_kpis(
  p_start_iso       timestamptz,
  p_end_iso         timestamptz,
  p_prev_start_iso  timestamptz,
  p_prev_end_iso    timestamptz,
  p_store_id        uuid DEFAULT NULL
)
RETURNS TABLE (
  revenue_mtd       numeric,
  orders_mtd        bigint,
  refunded_revenue  numeric,
  refunded_orders   bigint,
  prev_revenue      numeric,
  prev_orders       bigint,
  pending_orders    bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH
  -- Current period, non-cancelled (matches mtdQ + JS cancelled filter)
  mtd AS (
    SELECT total_price, financial_status
    FROM public.orders
    WHERE shopify_created_at >= p_start_iso
      AND shopify_created_at <= p_end_iso
      AND cancelled_at IS NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
  ),

  -- Previous period, non-cancelled (matches prevQ + JS cancelled filter)
  prev AS (
    SELECT total_price
    FROM public.orders
    WHERE shopify_created_at >= p_prev_start_iso
      AND shopify_created_at <= p_prev_end_iso
      AND cancelled_at IS NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
  )

  SELECT
    -- Current period
    COALESCE((SELECT SUM(total_price) FROM mtd), 0)::numeric                      AS revenue_mtd,
    (SELECT COUNT(*) FROM mtd)::bigint                                            AS orders_mtd,

    -- Refunds (fully + partially refunded), within current period
    COALESCE((SELECT SUM(total_price) FROM mtd
              WHERE financial_status IN ('refunded', 'partially_refunded')), 0)::numeric
                                                                                 AS refunded_revenue,
    (SELECT COUNT(*) FROM mtd
       WHERE financial_status IN ('refunded', 'partially_refunded'))::bigint     AS refunded_orders,

    -- Previous period
    COALESCE((SELECT SUM(total_price) FROM prev), 0)::numeric                     AS prev_revenue,
    (SELECT COUNT(*) FROM prev)::bigint                                           AS prev_orders,

    -- Pending fulfillment (paid, unfulfilled, not cancelled) — NOT date-bounded
    (SELECT COUNT(*)
       FROM public.orders
      WHERE financial_status = 'paid'
        AND fulfillment_status IS NULL
        AND cancelled_at IS NULL
        AND (p_store_id IS NULL OR store_id = p_store_id))::bigint               AS pending_orders
$$;

GRANT EXECUTE ON FUNCTION public.get_sales_kpis(timestamptz, timestamptz, timestamptz, timestamptz, uuid)
  TO authenticated, anon;
