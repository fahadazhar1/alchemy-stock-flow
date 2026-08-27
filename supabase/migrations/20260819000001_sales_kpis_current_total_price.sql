-- get_sales_kpis was summing total_price (frozen at order creation) for the
-- top "Revenue (MTD)" KPI, while get_store_period_channel_sales (Sales Pulse)
-- already sums current_total_price (live, nets out refunds/partial-refunds/
-- edits) — see 20260803000004_store_period_channel_sales_current_price_ksa_tz.sql.
-- The two cards showed different revenue for the same period as a result.
-- Standing rule for this project: any order revenue/sales reporting must use
-- current_total_price, never total_price. Switches revenue_mtd + prev_revenue
-- to current_total_price so the top KPI matches Sales Pulse and Shopify itself.
--
-- refunded_revenue is left on total_price deliberately — it answers "value of
-- orders that were refunded" for the refund-rate tile, a different question
-- from period revenue.

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
  mtd AS (
    SELECT total_price, current_total_price, financial_status
    FROM public.orders
    WHERE shopify_created_at >= p_start_iso
      AND shopify_created_at <= p_end_iso
      AND cancelled_at IS NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
  ),

  prev AS (
    SELECT current_total_price
    FROM public.orders
    WHERE shopify_created_at >= p_prev_start_iso
      AND shopify_created_at <= p_prev_end_iso
      AND cancelled_at IS NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
  )

  SELECT
    -- Current period — live, post-refund/post-edit (matches Sales Pulse)
    COALESCE((SELECT SUM(current_total_price) FROM mtd), 0)::numeric           AS revenue_mtd,
    (SELECT COUNT(*) FROM mtd)::bigint                                        AS orders_mtd,

    -- Refunds (fully + partially refunded), within current period
    COALESCE((SELECT SUM(total_price) FROM mtd
              WHERE financial_status IN ('refunded', 'partially_refunded')), 0)::numeric
                                                                                 AS refunded_revenue,
    (SELECT COUNT(*) FROM mtd
       WHERE financial_status IN ('refunded', 'partially_refunded'))::bigint     AS refunded_orders,

    -- Previous period — live, same basis as current period
    COALESCE((SELECT SUM(current_total_price) FROM prev), 0)::numeric          AS prev_revenue,
    (SELECT COUNT(*) FROM prev)::bigint                                        AS prev_orders,

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
