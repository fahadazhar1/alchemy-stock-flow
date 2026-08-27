-- Full-dashboard audit (2026-08-19) found 12 more revenue/net-sales aggregates
-- still summing total_price (frozen at order creation) instead of
-- current_total_price (live, nets out refunds/partial-refunds/edits) — the same
-- bug already fixed on get_sales_kpis in 20260819000001. Standing rule: any
-- Shopify order revenue/sales reporting must use current_total_price.
--
-- Left on total_price deliberately, NOT touched here (different question from
-- period revenue, same pattern as get_sales_kpis.refunded_revenue):
--   get_store_sales_metrics.cur_refunded_revenue — "value of orders that had a
--   refund" for the refund-rate stat, not period revenue.

-- 1. Revenue Trend chart ---------------------------------------------------------
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
    COALESCE(SUM(current_total_price), 0)::numeric    AS revenue,
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
    COALESCE(SUM(current_total_price), 0)::numeric,
    COUNT(*)::bigint
  FROM public.orders
  WHERE shopify_created_at >= p_prev_start_iso
    AND shopify_created_at <= p_prev_end_iso
    AND cancelled_at IS NULL
    AND (p_store_id IS NULL OR store_id = p_store_id)
  GROUP BY 2
$$;

-- 2. Channel Performance page -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_channel_performance(
  p_start_iso  timestamptz,
  p_end_iso    timestamptz,
  p_store_id   uuid DEFAULT NULL
)
RETURNS TABLE (
  source_name  text,
  bucket_date  date,
  revenue      numeric,
  orders       bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    source_name,
    (shopify_created_at AT TIME ZONE 'UTC')::date       AS bucket_date,
    COALESCE(SUM(current_total_price), 0)::numeric      AS revenue,
    COUNT(*)::bigint                                    AS orders
  FROM public.orders
  WHERE shopify_created_at >= p_start_iso
    AND shopify_created_at <= p_end_iso
    AND cancelled_at IS NULL
    AND (p_store_id IS NULL OR store_id = p_store_id)
  GROUP BY source_name, 2
$$;

-- 3. Customer New/Returning revenue split -----------------------------------------
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
      COALESCE(current_total_price, 0) AS order_revenue
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
        WHEN pc.customer_first_order_at IS NOT NULL AND pc.customer_first_order_at >= p_start_iso
          THEN 'new'
        WHEN pc.customer_first_order_at IS NOT NULL AND pc.customer_first_order_at < p_start_iso
          THEN 'returning'
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

-- 4 & 5. Discount usage card + Channel conversion (Traffic Sources) --------------
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
    SELECT current_total_price,
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
    COALESCE(SUM(current_total_price), 0)::numeric,
    COALESCE(SUM(current_total_price) FILTER (WHERE is_disc), 0)::numeric
  FROM flagged;
$$;

CREATE OR REPLACE FUNCTION public.get_channel_conversion(
  p_start_iso timestamptz,
  p_end_iso   timestamptz,
  p_store_id  uuid DEFAULT NULL
)
RETURNS TABLE (source_name text, orders bigint, revenue numeric)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT source_name,
         COUNT(*)::bigint                               AS orders,
         COALESCE(SUM(current_total_price), 0)::numeric  AS revenue
  FROM public.orders
  WHERE shopify_created_at >= p_start_iso
    AND shopify_created_at <= p_end_iso
    AND cancelled_at IS NULL
    AND (p_store_id IS NULL OR store_id = p_store_id)
  GROUP BY source_name;
$$;

-- 6. Store Performance Cards -------------------------------------------------------
CREATE OR REPLACE FUNCTION get_store_sales_metrics(
  p_start_iso  timestamptz,
  p_end_iso    timestamptz,
  p_prev_start timestamptz,
  p_prev_end   timestamptz
)
RETURNS TABLE (
  store_id             uuid,
  cur_revenue          numeric,
  cur_orders           bigint,
  cur_refunded_orders  bigint,
  cur_refunded_revenue numeric,
  prev_revenue         numeric,
  prev_orders          bigint,
  units_sold           bigint
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  WITH cur AS (
    SELECT
      store_id,
      COUNT(*) FILTER (WHERE cancelled_at IS NULL)
        AS cur_orders,
      SUM(current_total_price) FILTER (WHERE cancelled_at IS NULL)
        AS cur_revenue,
      COUNT(*) FILTER (WHERE cancelled_at IS NULL
        AND financial_status IN ('refunded','partially_refunded'))
        AS cur_refunded_orders,
      SUM(total_price) FILTER (WHERE cancelled_at IS NULL
        AND financial_status IN ('refunded','partially_refunded'))
        AS cur_refunded_revenue
    FROM orders
    WHERE shopify_created_at >= p_start_iso
      AND shopify_created_at <= p_end_iso
    GROUP BY store_id
  ),
  prev AS (
    SELECT
      store_id,
      COUNT(*) FILTER (WHERE cancelled_at IS NULL)               AS prev_orders,
      SUM(current_total_price) FILTER (WHERE cancelled_at IS NULL) AS prev_revenue
    FROM orders
    WHERE shopify_created_at >= p_prev_start
      AND shopify_created_at <= p_prev_end
    GROUP BY store_id
  ),
  units AS (
    SELECT
      store_id,
      SUM(quantity)::bigint AS units_sold
    FROM v_order_product_revenue
    WHERE order_date >= p_start_iso::date
      AND order_date <= p_end_iso::date
      AND cancelled_at IS NULL
    GROUP BY store_id
  )
  SELECT
    COALESCE(c.store_id, p.store_id, u.store_id) AS store_id,
    COALESCE(c.cur_revenue,          0)           AS cur_revenue,
    COALESCE(c.cur_orders,           0)           AS cur_orders,
    COALESCE(c.cur_refunded_orders,  0)           AS cur_refunded_orders,
    COALESCE(c.cur_refunded_revenue, 0)           AS cur_refunded_revenue,
    COALESCE(p.prev_revenue,         0)           AS prev_revenue,
    COALESCE(p.prev_orders,          0)           AS prev_orders,
    COALESCE(u.units_sold,           0)           AS units_sold
  FROM cur c
  FULL JOIN prev  p USING (store_id)
  FULL JOIN units u USING (store_id);
$$;

-- 7 & 8. Discount Performance page (per-code table + discounted-vs-full-price) ----
CREATE OR REPLACE VIEW v_discount_code_performance AS
SELECT
  dc->>'code'                                      AS discount_code,
  dc->>'type'                                      AS discount_type,
  o.store_id,
  COUNT(*)::int                                    AS usage_count,
  COALESCE(SUM(o.current_total_price), 0)          AS total_revenue,
  COALESCE(SUM(o.total_discounts), 0)              AS total_discount_given,
  ROUND(AVG(o.current_total_price)::numeric, 2)    AS avg_order_value,
  MIN(o.shopify_created_at)                        AS first_used_at,
  MAX(o.shopify_created_at)                        AS last_used_at
FROM orders o,
  LATERAL jsonb_array_elements(o.discount_codes) AS dc
WHERE o.cancelled_at IS NULL
  AND o.discount_codes IS NOT NULL
  AND jsonb_array_length(o.discount_codes) > 0
GROUP BY dc->>'code', dc->>'type', o.store_id
ORDER BY usage_count DESC;

CREATE OR REPLACE VIEW v_discount_performance AS
SELECT
  DATE_TRUNC('day', shopify_created_at)::date             AS sale_date,
  store_id,
  COUNT(*)                                                 AS total_orders,
  COUNT(*) FILTER (WHERE total_discounts > 0)              AS discounted_orders,
  COUNT(*) FILTER (WHERE COALESCE(total_discounts, 0) = 0) AS full_price_orders,
  COALESCE(SUM(total_discounts), 0)                        AS total_discount_amount,
  COALESCE(AVG(current_total_price) FILTER (WHERE total_discounts > 0), 0)              AS avg_discounted_aov,
  COALESCE(AVG(current_total_price) FILTER (WHERE COALESCE(total_discounts, 0) = 0), 0) AS avg_full_price_aov,
  COALESCE(SUM(current_total_price) FILTER (WHERE total_discounts > 0), 0)              AS discounted_revenue,
  COALESCE(SUM(current_total_price) FILTER (WHERE COALESCE(total_discounts, 0) = 0), 0) AS full_price_revenue
FROM orders
WHERE cancelled_at IS NULL
  AND shopify_created_at IS NOT NULL
GROUP BY DATE_TRUNC('day', shopify_created_at)::date, store_id
ORDER BY sale_date DESC;

-- 9-12. Reports page (Sales by Channel, Revenue Trend, Fulfillment Summary, Revenue KPIs)
CREATE OR REPLACE FUNCTION public.get_report_sales_by_channel(
  p_from      timestamptz DEFAULT NULL,
  p_store_id  uuid        DEFAULT NULL
)
RETURNS TABLE (channel text, revenue numeric, orders bigint, aov numeric)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    COALESCE(source_name, 'Unknown')                                                    AS channel,
    COALESCE(SUM(current_total_price), 0)::numeric                                      AS revenue,
    COUNT(*)::bigint                                                                     AS orders,
    CASE WHEN COUNT(*) > 0
         THEN (COALESCE(SUM(current_total_price), 0) / COUNT(*))::numeric
         ELSE 0 END                                                                     AS aov
  FROM public.orders
  WHERE cancelled_at IS NULL
    AND (p_from IS NULL OR shopify_created_at >= p_from)
    AND (p_store_id IS NULL OR store_id = p_store_id)
  GROUP BY COALESCE(source_name, 'Unknown')
  ORDER BY revenue DESC
$$;

CREATE OR REPLACE FUNCTION public.get_report_sales_trend(
  p_from      timestamptz DEFAULT NULL,
  p_store_id  uuid        DEFAULT NULL
)
RETURNS TABLE (date date, revenue numeric, orders bigint)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    (shopify_created_at AT TIME ZONE 'UTC')::date       AS date,
    COALESCE(SUM(current_total_price), 0)::numeric      AS revenue,
    COUNT(*)::bigint                                    AS orders
  FROM public.orders
  WHERE cancelled_at IS NULL
    AND (p_from IS NULL OR shopify_created_at >= p_from)
    AND (p_store_id IS NULL OR store_id = p_store_id)
  GROUP BY 1
  ORDER BY 1
$$;

CREATE OR REPLACE FUNCTION public.get_report_fulfillment_summary(
  p_from      timestamptz DEFAULT NULL,
  p_store_id  uuid        DEFAULT NULL
)
RETURNS TABLE (
  total bigint, fulfilled bigint, unfulfilled bigint, partial bigint,
  paid bigint, pending bigint, refunded bigint, total_revenue numeric
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE fulfillment_status = 'fulfilled')::bigint,
    COUNT(*) FILTER (WHERE fulfillment_status = 'unfulfilled' OR fulfillment_status IS NULL)::bigint,
    COUNT(*) FILTER (WHERE fulfillment_status = 'partial')::bigint,
    COUNT(*) FILTER (WHERE financial_status = 'paid')::bigint,
    COUNT(*) FILTER (WHERE financial_status = 'pending')::bigint,
    COUNT(*) FILTER (WHERE financial_status = 'refunded')::bigint,
    COALESCE(SUM(current_total_price), 0)::numeric
  FROM public.orders
  WHERE cancelled_at IS NULL
    AND (p_from IS NULL OR shopify_created_at >= p_from)
    AND (p_store_id IS NULL OR store_id = p_store_id)
$$;

CREATE OR REPLACE FUNCTION public.get_report_revenue_kpis(
  p_from        timestamptz DEFAULT NULL,
  p_prior_from  timestamptz DEFAULT NULL,
  p_prior_to    timestamptz DEFAULT NULL,
  p_store_id    uuid        DEFAULT NULL
)
RETURNS TABLE (revenue numeric, orders bigint, aov numeric, prior_revenue numeric)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH cur AS (
    SELECT COALESCE(SUM(current_total_price), 0) AS revenue, COUNT(*) AS orders
    FROM public.orders
    WHERE cancelled_at IS NULL
      AND (p_from IS NULL OR shopify_created_at >= p_from)
      AND (p_store_id IS NULL OR store_id = p_store_id)
  ),
  prior AS (
    SELECT COALESCE(SUM(current_total_price), 0) AS revenue
    FROM public.orders
    WHERE cancelled_at IS NULL
      AND (p_prior_from IS NULL OR shopify_created_at >= p_prior_from)
      AND (p_prior_to   IS NULL OR shopify_created_at <  p_prior_to)
      AND (p_store_id IS NULL OR store_id = p_store_id)
  )
  SELECT
    cur.revenue::numeric,
    cur.orders::bigint,
    CASE WHEN cur.orders > 0 THEN (cur.revenue / cur.orders)::numeric ELSE 0 END AS aov,
    prior.revenue::numeric AS prior_revenue
  FROM cur, prior
$$;
