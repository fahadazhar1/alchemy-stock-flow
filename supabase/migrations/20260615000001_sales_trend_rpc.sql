-- ── get_sales_trend ───────────────────────────────────────────────────────────
-- Server-side daily aggregation for the useSalesTrend hook (Revenue trend chart).
--
-- Replaces two .limit(10000) raw order fetches (current + previous period) with
-- per-day SUM/COUNT rollups. The browser receives ~30-60 daily rows per period
-- instead of up to 20,000 order rows. Pure read-only.
--
-- CRITICAL — day bucketing must match the old JS exactly:
--   The JS bucketed by `new Date(shopify_created_at.slice(0,10))`, i.e. the
--   order's UTC calendar date. PostgREST serialises timestamptz in UTC, so
--   slice(0,10) == the UTC date. We reproduce that with
--   `(shopify_created_at AT TIME ZONE 'UTC')::date` — NOT a plain `::date`,
--   which would use the session timezone and could shift bars by a day.
--
-- The hook keeps ALL downstream logic in JS (day-index alignment vs period
-- start, totalDays loop, labels, projected) — this function only replaces the
-- raw fetch + the per-row bucket SUM/COUNT.
--
-- NULL total_price: COUNT(*) still counts the order (matches JS orders += 1),
-- SUM treats it as 0 (matches Number(null ?? 0)).
--
-- No .limit cap (user-approved) — periods with >10k orders now bucket in full.

CREATE OR REPLACE FUNCTION public.get_sales_trend(
  p_start_iso       timestamptz,
  p_end_iso         timestamptz,
  p_prev_start_iso  timestamptz,
  p_prev_end_iso    timestamptz,
  p_store_id        uuid DEFAULT NULL
)
RETURNS TABLE (
  period       text,
  bucket_date  date,
  revenue      numeric,
  orders       bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    'cur'::text                                       AS period,
    (shopify_created_at AT TIME ZONE 'UTC')::date     AS bucket_date,
    COALESCE(SUM(total_price), 0)::numeric            AS revenue,
    COUNT(*)::bigint                                  AS orders
  FROM public.orders
  WHERE shopify_created_at >= p_start_iso
    AND shopify_created_at <= p_end_iso
    AND cancelled_at IS NULL
    AND (p_store_id IS NULL OR store_id = p_store_id)
  GROUP BY 2

  UNION ALL

  SELECT
    'prev'::text,
    (shopify_created_at AT TIME ZONE 'UTC')::date,
    COALESCE(SUM(total_price), 0)::numeric,
    COUNT(*)::bigint
  FROM public.orders
  WHERE shopify_created_at >= p_prev_start_iso
    AND shopify_created_at <= p_prev_end_iso
    AND cancelled_at IS NULL
    AND (p_store_id IS NULL OR store_id = p_store_id)
  GROUP BY 2
$$;

GRANT EXECUTE ON FUNCTION public.get_sales_trend(timestamptz, timestamptz, timestamptz, timestamptz, uuid)
  TO authenticated, anon;
