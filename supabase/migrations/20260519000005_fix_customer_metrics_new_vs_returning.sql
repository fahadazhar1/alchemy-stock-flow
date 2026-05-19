-- Fix get_customer_metrics:
-- 1. Rename columns to match Shopify's new/returning terminology
-- 2. Fix identity matching: use OR logic (shopify_customer_id OR email) so a customer
--    with shopify_customer_id in recent orders but only email in older (pre-backfill)
--    orders is still correctly identified as "returning"

DROP FUNCTION IF EXISTS public.get_customer_metrics(timestamptz, timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.get_customer_metrics(
  p_start_iso  timestamptz,
  p_end_iso    timestamptz,
  p_store_id   uuid DEFAULT NULL
)
RETURNS TABLE (
  total_customers     bigint,
  new_customers       bigint,   -- first ever order is within the period (Shopify: "new")
  returning_customers bigint,   -- ordered before AND in period (Shopify: "returning")
  new_pct             numeric,
  returning_pct       numeric,
  new_revenue         numeric,
  returning_revenue   numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH
  -- Non-cancelled orders in the period, preserving both identity fields
  period_orders AS (
    SELECT
      shopify_customer_id,
      customer_email,
      COALESCE(shopify_customer_id, customer_email, id::text) AS customer_key,
      COALESCE(total_price, 0)                                AS order_revenue
    FROM public.orders
    WHERE shopify_created_at >= p_start_iso
      AND shopify_created_at <= p_end_iso
      AND cancelled_at IS NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
  ),
  -- One row per unique customer; carry through both identity fields for OR matching
  period_customers AS (
    SELECT
      customer_key,
      MAX(shopify_customer_id) AS shopify_customer_id,
      MAX(customer_email)      AS customer_email,
      SUM(order_revenue)       AS period_revenue
    FROM period_orders
    GROUP BY customer_key
  ),
  -- Pre-period orders: collect both fields so we can OR-match against the period customers.
  -- This handles partial shopify_customer_id backfill: a customer might have their Shopify ID
  -- on new orders but only an email on older pre-period orders. COALESCE-only matching misses them.
  pre_period AS (
    SELECT DISTINCT
      shopify_customer_id,
      customer_email
    FROM public.orders
    WHERE shopify_created_at < p_start_iso
      AND cancelled_at IS NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
      AND (shopify_customer_id IS NOT NULL OR customer_email IS NOT NULL)
  ),
  -- Classify: "returning" if shopify_customer_id OR email matches any pre-period order
  customer_type AS (
    SELECT
      pc.customer_key,
      pc.period_revenue,
      CASE
        WHEN EXISTS (
          SELECT 1 FROM pre_period pp
          WHERE (pc.shopify_customer_id IS NOT NULL AND pp.shopify_customer_id = pc.shopify_customer_id)
             OR (pc.customer_email      IS NOT NULL AND pp.customer_email      = pc.customer_email)
        ) THEN 'returning'
        ELSE 'new'
      END AS ctype
    FROM period_customers pc
  ),
  agg AS (
    SELECT
      COUNT(*)                                                              AS total_customers,
      COUNT(*)      FILTER (WHERE ctype = 'new')                           AS new_customers,
      COUNT(*)      FILTER (WHERE ctype = 'returning')                     AS returning_customers,
      COALESCE(SUM(period_revenue) FILTER (WHERE ctype = 'new'),       0) AS new_revenue,
      COALESCE(SUM(period_revenue) FILTER (WHERE ctype = 'returning'), 0) AS returning_revenue
    FROM customer_type
  )
  SELECT
    total_customers,
    new_customers,
    returning_customers,
    CASE WHEN total_customers = 0 THEN 0::numeric
         ELSE ROUND(new_customers::numeric       / total_customers * 100, 1) END,
    CASE WHEN total_customers = 0 THEN 0::numeric
         ELSE ROUND(returning_customers::numeric / total_customers * 100, 1) END,
    new_revenue,
    returning_revenue
  FROM agg;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_metrics(timestamptz, timestamptz, uuid)
  TO authenticated, anon;
