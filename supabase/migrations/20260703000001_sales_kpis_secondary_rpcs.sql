-- ── Secondary Sales-KPI aggregation RPCs ──────────────────────────────────────
-- Replaces three raw .limit(10000) order fetches in useSalesKPIs.ts
-- (useFulfillmentMetrics, useDiscountUsage, useChannelConversion) with server-side
-- aggregates, so the browser receives a handful of numbers instead of every order row.
--
-- FIGURE-PARITY CONTRACT (must stay bit-identical to the old JS path):
--  • Each RPC returns raw COUNT/SUM components only. All ratios, rounding, sorting,
--    top-N slicing and share % stay in the hook's JS — identical arithmetic as before.
--  • Filters mirror the old queries exactly:
--      fulfillment: fulfillment_status='fulfilled', cancelled_at IS NULL,
--                   closed_at IS NOT NULL, lag in [0h, 720h)  (== [0, 30 days) in JS)
--      discount:    cancelled_at IS NULL; discounted = discount_codes IS NOT NULL
--                   OR COALESCE(total_discounts,0) > 0  (verified: discount_codes is
--                   either SQL NULL or a JSON array — no JSON-null case — so IS NOT NULL
--                   == the JS `!= null`).
--      channel:     cancelled_at IS NULL; grouped by source_name (NULL kept as NULL,
--                   the hook maps it to "Unknown" exactly as before).
--  All SECURITY INVOKER + STABLE, granted to authenticated, anon (same as get_sales_kpis).

-- 1) Fulfillment lag ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_fulfillment_metrics(
  p_start_iso timestamptz,
  p_end_iso   timestamptz,
  p_store_id  uuid DEFAULT NULL
)
RETURNS TABLE (sum_lag_hours double precision, orders_analyzed bigint)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  WITH lags AS (
    SELECT EXTRACT(EPOCH FROM (closed_at - shopify_created_at)) / 3600.0 AS lag_h
    FROM public.orders
    WHERE fulfillment_status = 'fulfilled'
      AND shopify_created_at >= p_start_iso
      AND shopify_created_at <= p_end_iso
      AND cancelled_at IS NULL
      AND closed_at IS NOT NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
  )
  SELECT COALESCE(SUM(lag_h), 0)::double precision, COUNT(*)::bigint
  FROM lags
  WHERE lag_h >= 0 AND lag_h < 720;
$$;
GRANT EXECUTE ON FUNCTION public.get_fulfillment_metrics(timestamptz, timestamptz, uuid) TO authenticated, anon;

-- 2) Discount usage -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_discount_usage(
  p_start_iso timestamptz,
  p_end_iso   timestamptz,
  p_store_id  uuid DEFAULT NULL
)
RETURNS TABLE (
  total_orders       bigint,
  discounted_orders  bigint,
  total_revenue      numeric,
  discounted_revenue numeric
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  WITH flagged AS (
    SELECT total_price,
           (discount_codes IS NOT NULL OR COALESCE(total_discounts, 0) > 0) AS is_disc
    FROM public.orders
    WHERE shopify_created_at >= p_start_iso
      AND shopify_created_at <= p_end_iso
      AND cancelled_at IS NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
  )
  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE is_disc)::bigint,
    COALESCE(SUM(total_price), 0)::numeric,
    COALESCE(SUM(total_price) FILTER (WHERE is_disc), 0)::numeric
  FROM flagged;
$$;
GRANT EXECUTE ON FUNCTION public.get_discount_usage(timestamptz, timestamptz, uuid) TO authenticated, anon;

-- 3) Channel conversion (grouped by source_name) --------------------------------
CREATE OR REPLACE FUNCTION public.get_channel_conversion(
  p_start_iso timestamptz,
  p_end_iso   timestamptz,
  p_store_id  uuid DEFAULT NULL
)
RETURNS TABLE (source_name text, orders bigint, revenue numeric)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT source_name,
         COUNT(*)::bigint       AS orders,
         COALESCE(SUM(total_price), 0)::numeric AS revenue
  FROM public.orders
  WHERE shopify_created_at >= p_start_iso
    AND shopify_created_at <= p_end_iso
    AND cancelled_at IS NULL
    AND (p_store_id IS NULL OR store_id = p_store_id)
  GROUP BY source_name;
$$;
GRANT EXECUTE ON FUNCTION public.get_channel_conversion(timestamptz, timestamptz, uuid) TO authenticated, anon;
