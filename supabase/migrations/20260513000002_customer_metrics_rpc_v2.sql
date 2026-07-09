-- ── get_customer_metrics v2 ───────────────────────────────────────────────────
-- Fixes LTV returning £0 when historical orders have NULL customer_email.
--
-- LTV change: group lifetime revenue by COALESCE(customer_email, id::text)
-- so every order contributes, identified or not. Once emails are backfilled
-- via re-sync this automatically becomes true per-customer LTV.
--
-- Retention is unchanged — it is intentionally email-only (cohort matching
-- requires a stable identity). It will show correct data once the Shopify
-- sync backfills customer_email on historical orders (see reset below).

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

  -- Order count per customer key
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

  -- Identified emails that bought BEFORE the period (retention denominator)
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

  -- Lifetime revenue grouped by best available identity
  -- COALESCE ensures guest orders (null email) still contribute to LTV
  lifetime_stats AS (
    SELECT
      COUNT(DISTINCT COALESCE(customer_email, id::text)) AS total_buyers,
      COALESCE(SUM(total_price), 0)                     AS total_revenue
    FROM public.orders
    WHERE cancelled_at IS NULL
      AND (p_store_id IS NULL OR store_id = p_store_id)
  )

  SELECT
    (SELECT COUNT(*)                          FROM period_counts)::bigint,
    (SELECT COUNT(*) FROM period_counts WHERE order_count > 1)::bigint,

    CASE
      WHEN (SELECT COUNT(*) FROM pre_period_emails) = 0 THEN 0::numeric
      ELSE ROUND(
             (SELECT COUNT(*) FROM retained)::numeric
           / (SELECT COUNT(*) FROM pre_period_emails)::numeric
           * 100, 1
         )
    END,

    CASE
      WHEN (SELECT total_buyers FROM lifetime_stats) = 0 THEN 0::numeric
      ELSE ROUND(
             (SELECT total_revenue FROM lifetime_stats)
           / (SELECT total_buyers  FROM lifetime_stats),
           2
         )
    END
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_metrics(timestamptz, timestamptz, uuid)
  TO authenticated, anon;

-- ── Backfill trigger: reset last_sync_at so next Shopify sync re-fetches ──────
-- all orders from year-start with updated_at_min, writing customer_email
-- onto every historical order row. Retention rate will then show real data.
UPDATE public.shopify_connections
SET    last_sync_at = NULL
WHERE  last_sync_at IS NOT NULL;
