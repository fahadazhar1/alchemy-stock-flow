-- 1. Add shopify_customer_id to orders for stable identity across guest/logged-in orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shopify_customer_id text;

CREATE INDEX IF NOT EXISTS idx_orders_shopify_customer_id
  ON public.orders(shopify_customer_id) WHERE shopify_customer_id IS NOT NULL;

-- 2. Rewrite get_customer_metrics: new vs returning (Shopify-standard definition)
--
-- Identity key priority: shopify_customer_id > customer_email > internal UUID
-- (UUID fallback = guest with no email — always counted as "new", can't link)
--
-- New customer     = first order ever is within the selected period
-- Returning customer = has at least one order BEFORE the period AND ordered in the period
--
-- Revenue = sum of that customer's orders within the selected period only.

DROP FUNCTION IF EXISTS public.get_customer_metrics(timestamptz, timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.get_customer_metrics(
  p_start_iso  timestamptz,
  p_end_iso    timestamptz,
  p_store_id   uuid DEFAULT NULL
)
RETURNS TABLE (
  total_customers    bigint,
  one_time_customers bigint,   -- "new" customers (first order in period)
  repeat_customers   bigint,   -- "returning" customers (ordered before + in period)
  one_time_pct       numeric,
  repeat_pct         numeric,
  one_time_revenue   numeric,
  repeat_revenue     numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH
  -- All orders in the selected period (non-cancelled)
  period_orders AS (
    SELECT
      COALESCE(shopify_customer_id, customer_email, id::text) AS customer_key,
      COALESCE(total_price, 0)                                AS order_revenue
    FROM public.orders
    WHERE shopify_created_at >= p_start_iso
      AND shopify_created_at <= p_end_iso
      AND cancelled_at IS NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
  ),
  -- Revenue per customer within the period
  period_customer_revenue AS (
    SELECT
      customer_key,
      SUM(order_revenue) AS period_revenue
    FROM period_orders
    GROUP BY customer_key
  ),
  -- Customers who had any order BEFORE the period (same identity key)
  pre_period_customers AS (
    SELECT DISTINCT
      COALESCE(shopify_customer_id, customer_email, id::text) AS customer_key
    FROM public.orders
    WHERE shopify_created_at < p_start_iso
      AND cancelled_at IS NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
  ),
  -- Classify: returning if a matching key exists pre-period, else new
  customer_type AS (
    SELECT
      pcr.customer_key,
      pcr.period_revenue,
      CASE WHEN ppc.customer_key IS NOT NULL THEN 'returning' ELSE 'new' END AS ctype
    FROM period_customer_revenue pcr
    LEFT JOIN pre_period_customers ppc ON ppc.customer_key = pcr.customer_key
  ),
  agg AS (
    SELECT
      COUNT(*)                                                          AS total_customers,
      COUNT(*)      FILTER (WHERE ctype = 'new')                       AS new_customers,
      COUNT(*)      FILTER (WHERE ctype = 'returning')                 AS returning_customers,
      COALESCE(SUM(period_revenue) FILTER (WHERE ctype = 'new'),      0) AS new_revenue,
      COALESCE(SUM(period_revenue) FILTER (WHERE ctype = 'returning'), 0) AS returning_revenue
    FROM customer_type
  )
  SELECT
    total_customers,
    new_customers,
    returning_customers,
    CASE WHEN total_customers = 0 THEN 0::numeric
         ELSE ROUND(new_customers::numeric    / total_customers * 100, 1) END,
    CASE WHEN total_customers = 0 THEN 0::numeric
         ELSE ROUND(returning_customers::numeric / total_customers * 100, 1) END,
    new_revenue,
    returning_revenue
  FROM agg;
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_metrics(timestamptz, timestamptz, uuid)
  TO authenticated, anon;

-- 3. Reset sync so all historical orders get shopify_customer_id backfilled
UPDATE public.shopify_connections
SET last_sync_at = NULL
WHERE last_sync_at IS NOT NULL;
