-- ── get_customer_metrics ─────────────────────────────────────────────────────
-- Server-side aggregation for the Customer Metrics card.
-- All four metrics are computed in a single query plan so no raw rows are
-- transferred to the client.
--
-- Parameters:
--   p_start_iso  – period start (inclusive)
--   p_end_iso    – period end   (inclusive)
--   p_store_id   – optional store filter (NULL = all stores)
--
-- Metric definitions (ecommerce-standard):
--
--   unique_customers  – distinct buyers (email or guest order-id) in period
--   repeat_customers  – buyers with >1 orders in the same period
--   retention_rate    – cohort repurchase rate:
--                         customers who bought BEFORE the period AND AGAIN
--                         inside it, divided by all customers who ever bought
--                         before the period  ×100
--   ltv               – average lifetime revenue per identified customer:
--                         SUM(lifetime revenue) / COUNT(distinct emails)
--                         across ALL historical orders (not just the period)

CREATE OR REPLACE FUNCTION public.get_customer_metrics(
  p_start_iso  timestamptz,
  p_end_iso    timestamptz,
  p_store_id   uuid DEFAULT NULL
)
RETURNS TABLE (
  unique_customers  bigint,
  repeat_customers  bigint,
  retention_rate    numeric,
  ltv               numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH
  -- Non-cancelled orders inside the selected period
  period_orders AS (
    SELECT
      COALESCE(customer_email, id::text) AS customer_key,
      customer_email
    FROM public.orders
    WHERE shopify_created_at >= p_start_iso
      AND shopify_created_at <= p_end_iso
      AND cancelled_at IS NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
  ),

  -- Order count per customer key (used for unique + repeat)
  period_counts AS (
    SELECT customer_key, COUNT(*) AS order_count
    FROM period_orders
    GROUP BY customer_key
  ),

  -- Identified emails active in the period
  period_emails AS (
    SELECT DISTINCT customer_email
    FROM period_orders
    WHERE customer_email IS NOT NULL
  ),

  -- Identified emails that had at least one order BEFORE the period
  pre_period_emails AS (
    SELECT DISTINCT customer_email
    FROM public.orders
    WHERE shopify_created_at < p_start_iso
      AND cancelled_at IS NULL
      AND customer_email IS NOT NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
  ),

  -- Retained = appeared before AND inside the period
  retained AS (
    SELECT pe.customer_email
    FROM period_emails      pe
    JOIN  pre_period_emails ppe ON ppe.customer_email = pe.customer_email
  ),

  -- Lifetime aggregates per identified customer (all-time, store-scoped)
  lifetime_stats AS (
    SELECT
      COUNT(DISTINCT customer_email) AS total_customers,
      COALESCE(SUM(total_price), 0)  AS total_revenue
    FROM public.orders
    WHERE cancelled_at IS NULL
      AND customer_email IS NOT NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
  )

  SELECT
    -- unique buyers in period
    (SELECT COUNT(*)                          FROM period_counts)::bigint,

    -- buyers with more than one order in period
    (SELECT COUNT(*) FROM period_counts WHERE order_count > 1)::bigint,

    -- cohort retention / repurchase rate
    CASE
      WHEN (SELECT COUNT(*) FROM pre_period_emails) = 0 THEN 0::numeric
      ELSE ROUND(
             (SELECT COUNT(*) FROM retained)::numeric
           / (SELECT COUNT(*) FROM pre_period_emails)::numeric
           * 100,
           1
         )
    END,

    -- average lifetime value per identified customer
    CASE
      WHEN (SELECT total_customers FROM lifetime_stats) = 0 THEN 0::numeric
      ELSE ROUND(
             (SELECT total_revenue  FROM lifetime_stats)
           / (SELECT total_customers FROM lifetime_stats),
           2
         )
    END
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_metrics(timestamptz, timestamptz, uuid)
  TO authenticated, anon;

-- Composite partial index to speed up the three scans inside the function
CREATE INDEX IF NOT EXISTS idx_orders_store_date_email
  ON public.orders (store_id, shopify_created_at)
  WHERE cancelled_at IS NULL;
