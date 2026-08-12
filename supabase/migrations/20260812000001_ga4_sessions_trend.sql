-- Monthly GA4 sessions trend (all channels combined = "total visitors"), for
-- the Net Sales Trend chart's new "Visitors" view. Mirrors
-- get_monthly_net_sales_trend's per-store/per-month shape. GA4 dates are
-- already plain calendar dates in each property's own reporting timezone —
-- no KSA UTC-shift needed here, same as the other GA4 RPCs.
CREATE OR REPLACE FUNCTION public.get_ga4_monthly_sessions_trend(p_start_date date, p_end_date date)
RETURNS TABLE (store_id uuid, month_start date, sessions bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT store_id, date_trunc('month', date)::date, COALESCE(SUM(sessions), 0)::bigint
  FROM public.ga4_daily_metrics
  WHERE date >= p_start_date AND date <= p_end_date
  GROUP BY store_id, date_trunc('month', date)
$$;

GRANT EXECUTE ON FUNCTION public.get_ga4_monthly_sessions_trend(date, date) TO authenticated;
