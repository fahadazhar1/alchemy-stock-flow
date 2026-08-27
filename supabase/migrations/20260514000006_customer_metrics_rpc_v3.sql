-- get_customer_metrics v3
-- Replaces LTV + retention with one-time vs repeat customer split.
--
-- Definitions (all scoped to selected period, cancelled orders excluded):
--   one_time_customers  = distinct customers with exactly 1 order in the period
--   repeat_customers    = distinct customers with 2+ orders in the period
--   total_customers     = one_time + repeat
--   one_time_pct/repeat_pct = share of total_customers
--   one_time_revenue    = sum of total_price for one-time customers' orders
--   repeat_revenue      = sum of total_price for repeat customers' orders
--
-- Customer identity: COALESCE(customer_email, order_id::text) so guest orders
-- are counted correctly even without an email address.

DROP FUNCTION IF EXISTS public.get_customer_metrics(timestamptz, timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.get_customer_metrics(
  p_start_iso  timestamptz,
  p_end_iso    timestamptz,
  p_store_id   uuid DEFAULT NULL
)
RETURNS TABLE (
  total_customers    bigint,
  one_time_customers bigint,
  repeat_customers   bigint,
  one_time_pct       numeric,
  repeat_pct         numeric,
  one_time_revenue   numeric,
  repeat_revenue     numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH period_orders AS (
    SELECT
      COALESCE(customer_email, id::text) AS customer_key,
      COALESCE(total_price, 0)           AS total_price
    FROM public.orders
    WHERE shopify_created_at >= p_start_iso
      AND shopify_created_at <= p_end_iso
      AND cancelled_at IS NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
  ),
  customer_stats AS (
    SELECT
      customer_key,
      COUNT(*)                     AS order_count,
      COALESCE(SUM(total_price),0) AS customer_revenue
    FROM period_orders
    GROUP BY customer_key
  ),
  agg AS (
    SELECT
      COUNT(*)                                                          AS total_customers,
      COUNT(*)      FILTER (WHERE order_count = 1)                     AS one_time_customers,
      COUNT(*)      FILTER (WHERE order_count > 1)                     AS repeat_customers,
      COALESCE(SUM(customer_revenue) FILTER (WHERE order_count = 1),0) AS one_time_revenue,
      COALESCE(SUM(customer_revenue) FILTER (WHERE order_count > 1),0) AS repeat_revenue
    FROM customer_stats
  )
  SELECT
    total_customers,
    one_time_customers,
    repeat_customers,
    CASE WHEN total_customers = 0 THEN 0::numeric
         ELSE ROUND(one_time_customers::numeric / total_customers * 100, 1)
    END AS one_time_pct,
    CASE WHEN total_customers = 0 THEN 0::numeric
         ELSE ROUND(repeat_customers::numeric / total_customers * 100, 1)
    END AS repeat_pct,
    one_time_revenue,
    repeat_revenue
  FROM agg;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_metrics(timestamptz, timestamptz, uuid)
  TO authenticated, anon;
