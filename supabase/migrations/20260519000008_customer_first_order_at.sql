-- Add customer_first_order_at to orders.
-- Populated from Shopify's customer.created_at (the date the customer account was created,
-- which equals their first-ever order date). This lets us classify new vs returning
-- without needing historical order sync coverage.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_first_order_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_customer_first_order_at
  ON public.orders(customer_first_order_at) WHERE customer_first_order_at IS NOT NULL;

-- Rewrite get_customer_metrics to use customer_first_order_at instead of pre-period order lookup.
-- New     = customer_first_order_at is within the selected period (first order is in this period)
-- Returning = customer_first_order_at is before the period start (they existed before this period)
-- Fallback  = if field is NULL (guest with no account), keep existing OR-match against pre-period orders

DROP FUNCTION IF EXISTS public.get_customer_metrics(timestamptz, timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.get_customer_metrics(
  p_start_iso  timestamptz,
  p_end_iso    timestamptz,
  p_store_id   uuid DEFAULT NULL
)
RETURNS TABLE (
  total_customers     bigint,
  new_customers       bigint,
  returning_customers bigint,
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
  period_orders AS (
    SELECT
      COALESCE(shopify_customer_id, customer_email, id::text) AS customer_key,
      shopify_customer_id,
      customer_email,
      customer_first_order_at,
      COALESCE(total_price, 0) AS order_revenue
    FROM public.orders
    WHERE shopify_created_at >= p_start_iso
      AND shopify_created_at <= p_end_iso
      AND cancelled_at IS NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
  ),
  period_customers AS (
    SELECT
      customer_key,
      MAX(shopify_customer_id)     AS shopify_customer_id,
      MAX(customer_email)          AS customer_email,
      MIN(customer_first_order_at) AS customer_first_order_at,
      SUM(order_revenue)           AS period_revenue
    FROM period_orders
    GROUP BY customer_key
  ),
  -- For guests with no customer_first_order_at, fall back to checking pre-period orders
  pre_period AS (
    SELECT DISTINCT shopify_customer_id, customer_email
    FROM public.orders
    WHERE shopify_created_at < p_start_iso
      AND cancelled_at IS NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
      AND (shopify_customer_id IS NOT NULL OR customer_email IS NOT NULL)
  ),
  customer_type AS (
    SELECT
      pc.customer_key,
      pc.period_revenue,
      CASE
        -- Primary: use Shopify's customer.created_at — works regardless of sync window
        WHEN pc.customer_first_order_at IS NOT NULL AND pc.customer_first_order_at >= p_start_iso
          THEN 'new'
        WHEN pc.customer_first_order_at IS NOT NULL AND pc.customer_first_order_at < p_start_iso
          THEN 'returning'
        -- Fallback for guests (no Shopify account): check pre-period order history
        WHEN EXISTS (
          SELECT 1 FROM pre_period pp
          WHERE (pc.shopify_customer_id IS NOT NULL AND pp.shopify_customer_id = pc.shopify_customer_id)
             OR (pc.customer_email IS NOT NULL AND pp.customer_email = pc.customer_email)
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
