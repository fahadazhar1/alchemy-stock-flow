-- ── get_store_daily_channel_sales ───────────────────────────────────────────
-- Powers the "Daily Sales Pulse" cards on the Store Performance Dashboard:
-- net sales + per-channel orders/value, today vs yesterday, per store.
--
-- Timezone: "today"/"yesterday" is computed per-store using stores.timezone
-- (NOT a single global timezone) — a UK order at 11pm and a PK order at 11pm
-- fall on different UTC dates, so each store's own calendar day is used.
--
-- Net revenue: orders has no per-line refund-amount column, only order-level
-- financial_status. Net = gross revenue (cancelled_at IS NULL) minus the full
-- order value of any refunded/partially_refunded order — same approximation
-- already used for refundRate/refundedRevenue in get_store_sales_metrics.
--
-- Egress-safe: returns ≤ (stores × 2 days × distinct source_name) rows, not
-- raw orders. The coarse `shopify_created_at >= now() - interval '3 days'`
-- filter keeps the index-friendly scan; the exact per-store-local-date bounds
-- refine it (3-day margin comfortably covers every timezone offset).

CREATE OR REPLACE FUNCTION public.get_store_daily_channel_sales()
RETURNS TABLE (
  store_id         uuid,
  bucket           text,       -- 'today' | 'yesterday'
  source_name      text,
  orders           bigint,
  revenue          numeric,
  refunded_orders  bigint,
  refunded_revenue numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    o.store_id,
    CASE
      WHEN (o.shopify_created_at AT TIME ZONE s.timezone)::date
           = (now() AT TIME ZONE s.timezone)::date
        THEN 'today'
      ELSE 'yesterday'
    END                                                                     AS bucket,
    o.source_name,
    COUNT(*) FILTER (WHERE o.cancelled_at IS NULL)                         AS orders,
    COALESCE(SUM(o.total_price) FILTER (WHERE o.cancelled_at IS NULL), 0)  AS revenue,
    COUNT(*) FILTER (
      WHERE o.cancelled_at IS NULL
        AND o.financial_status IN ('refunded', 'partially_refunded')
    )                                                                       AS refunded_orders,
    COALESCE(SUM(o.total_price) FILTER (
      WHERE o.cancelled_at IS NULL
        AND o.financial_status IN ('refunded', 'partially_refunded')
    ), 0)                                                                   AS refunded_revenue
  FROM public.orders o
  JOIN public.stores s ON s.id = o.store_id
  WHERE o.shopify_created_at >= now() - interval '3 days'
    AND (o.shopify_created_at AT TIME ZONE s.timezone)::date
        >= (now() AT TIME ZONE s.timezone)::date - 1
    AND (o.shopify_created_at AT TIME ZONE s.timezone)::date
        <= (now() AT TIME ZONE s.timezone)::date
  GROUP BY o.store_id, bucket, o.source_name
$$;

GRANT EXECUTE ON FUNCTION public.get_store_daily_channel_sales() TO authenticated, anon;
