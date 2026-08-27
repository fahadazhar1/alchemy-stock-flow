-- Daily history feed for the ClickUp Reports / KPI Tracker page — last N days,
-- one row per store per day. Sales must go through an RPC (touches `orders`,
-- per the egress rule); GA4 history is read directly from ga4_daily_metrics /
-- ga4_channel_daily in the frontend (already small, already has a read policy
-- for authenticated, same precedent as kpi_metric_config/daily_kpi_entries).
--
-- Bucketing follows the same per-store local-day pattern as
-- get_monthly_net_sales (20260826000001): KSA's store_id gets +2h shift
-- (Karachi->Riyadh) applied to both the range filter and the day bucket, the
-- other 3 stores bucket on shopify_created_at as-is (their `stores.timezone`
-- is already Asia/Karachi-equivalent for day-boundary purposes).
--
-- Revenue here matches the KPI Tracker's default "Actual" sales figure:
-- gross (shipping included, matches the Sales Pulse card's default
-- "Exclude shipping" = off), all channels, cancelled excluded.

CREATE OR REPLACE FUNCTION public.get_kpi_daily_sales_history(p_days integer DEFAULT 15)
RETURNS TABLE (store_id uuid, day date, revenue numeric, orders bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH shifted AS (
    SELECT
      store_id,
      (shopify_created_at + (CASE WHEN store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
                                   THEN interval '2 hours' ELSE interval '0' END))::date AS day,
      current_total_price,
      cancelled_at
    FROM public.orders
    WHERE shopify_created_at >= (now() - (p_days || ' days')::interval - interval '1 day')
  )
  SELECT store_id, day,
    COALESCE(SUM(current_total_price) FILTER (WHERE cancelled_at IS NULL), 0),
    COUNT(*) FILTER (WHERE cancelled_at IS NULL)
  FROM shifted
  WHERE day >= (CURRENT_DATE - (p_days - 1))
  GROUP BY store_id, day
  ORDER BY store_id, day;
$$;

GRANT EXECUTE ON FUNCTION public.get_kpi_daily_sales_history(integer) TO authenticated;
