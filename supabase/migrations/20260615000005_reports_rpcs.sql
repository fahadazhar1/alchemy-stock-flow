-- ── Reports v2 aggregation RPCs ───────────────────────────────────────────────
-- Server-side aggregation building blocks for the v2 Reports page, replacing the
-- 9× .limit(10000) raw fetches in src/pages/v2/lib/reportsEngine.ts. Each RPC
-- returns aggregated rows so the browser no longer pulls tens of thousands of
-- order / order_item / variant rows. All STABLE / read-only.
--
-- DELIBERATE BEHAVIOUR CHANGES vs the current reportsEngine.ts (approved — the new
-- Reports should reflect real Shopify order data and agree with the dashboard):
--   1. Date basis: filters on orders.shopify_created_at (actual order date), NOT
--      created_at (DB insert/sync time). Reports now line up with every other
--      dashboard metric.
--   2. Cancelled orders are EXCLUDED (cancelled_at IS NULL) from all order-based
--      aggregates, so revenue/orders/fulfilment reflect live orders only.
--   3. Day buckets use (shopify_created_at AT TIME ZONE 'UTC')::date, consistent
--      with get_sales_trend / get_channel_performance.
-- If you want gross (incl. cancelled) or sync-date behaviour for any report,
-- drop the relevant filter in that function.
--
-- Convention: p_from timestamptz (NULL = all-time, equivalent to range "all");
-- p_store_id uuid (NULL = all stores). Range→p_from is computed by the caller.

-- 1. Sales by channel ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_report_sales_by_channel(
  p_from      timestamptz DEFAULT NULL,
  p_store_id  uuid        DEFAULT NULL
)
RETURNS TABLE (channel text, revenue numeric, orders bigint, aov numeric)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    COALESCE(source_name, 'Unknown')                                          AS channel,
    COALESCE(SUM(total_price), 0)::numeric                                    AS revenue,
    COUNT(*)::bigint                                                          AS orders,
    CASE WHEN COUNT(*) > 0
         THEN (COALESCE(SUM(total_price), 0) / COUNT(*))::numeric
         ELSE 0 END                                                          AS aov
  FROM public.orders
  WHERE cancelled_at IS NULL
    AND (p_from IS NULL OR shopify_created_at >= p_from)
    AND (p_store_id IS NULL OR store_id = p_store_id)
  GROUP BY COALESCE(source_name, 'Unknown')
  ORDER BY revenue DESC
$$;

-- 2. Sales trend (daily) -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_report_sales_trend(
  p_from      timestamptz DEFAULT NULL,
  p_store_id  uuid        DEFAULT NULL
)
RETURNS TABLE (date date, revenue numeric, orders bigint)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    (shopify_created_at AT TIME ZONE 'UTC')::date  AS date,
    COALESCE(SUM(total_price), 0)::numeric         AS revenue,
    COUNT(*)::bigint                               AS orders
  FROM public.orders
  WHERE cancelled_at IS NULL
    AND (p_from IS NULL OR shopify_created_at >= p_from)
    AND (p_store_id IS NULL OR store_id = p_store_id)
  GROUP BY 1
  ORDER BY 1
$$;

-- 3. Top products by revenue ---------------------------------------------------
-- orders = number of order-item lines for the product (matches the old `orders += 1`
-- per line, NOT distinct orders).
CREATE OR REPLACE FUNCTION public.get_report_top_products(
  p_from      timestamptz DEFAULT NULL,
  p_limit     int         DEFAULT 20,
  p_store_id  uuid        DEFAULT NULL
)
RETURNS TABLE (product_id uuid, name text, type text, revenue numeric, units numeric, orders bigint)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    oi.product_id,
    COALESCE(p.name, 'Unknown')                                AS name,
    COALESCE(p.product_type, '—')                              AS type,
    COALESCE(SUM(oi.quantity * oi.unit_price), 0)::numeric     AS revenue,
    COALESCE(SUM(oi.quantity), 0)::numeric                     AS units,
    COUNT(*)::bigint                                           AS orders
  FROM public.order_items oi
  JOIN public.orders   o ON o.id = oi.order_id
  LEFT JOIN public.products p ON p.id = oi.product_id
  WHERE o.cancelled_at IS NULL
    AND (p_from IS NULL OR o.shopify_created_at >= p_from)
    AND (p_store_id IS NULL OR o.store_id = p_store_id)
  GROUP BY oi.product_id, p.name, p.product_type
  ORDER BY revenue DESC
  LIMIT p_limit
$$;

-- 4. Inventory KPIs ------------------------------------------------------------
-- Replaces fetchInventoryKPIs (which pulled ALL variants and reduced in JS).
-- All variants counted regardless of product status (matches old behaviour).
-- inventory_quantity may be negative (multistore fix) — negatives are low_stock,
-- not out_of_stock, exactly like the old isLowStock/isOutOfStock flags.
CREATE OR REPLACE FUNCTION public.get_report_inventory_kpis(
  p_store_id  uuid DEFAULT NULL
)
RETURNS TABLE (
  total_skus    bigint,
  out_of_stock  bigint,
  low_stock     bigint,
  expiring_soon bigint,
  total_value   numeric,
  total_units   numeric
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    COUNT(*)::bigint                                                                       AS total_skus,
    COUNT(*) FILTER (WHERE v.inventory_quantity = 0)::bigint                               AS out_of_stock,
    COUNT(*) FILTER (WHERE v.inventory_quantity <= 5 AND v.inventory_quantity <> 0)::bigint AS low_stock,
    COUNT(*) FILTER (WHERE v.expiry_date IS NOT NULL
                       AND v.expiry_date < (now() + interval '30 days'))::bigint           AS expiring_soon,
    COALESCE(SUM(v.price * v.inventory_quantity), 0)::numeric                              AS total_value,
    COALESCE(SUM(v.inventory_quantity), 0)::numeric                                        AS total_units
  FROM public.variants v
  JOIN public.products p ON p.id = v.product_id
  WHERE (p_store_id IS NULL OR p.store_id = p_store_id)
$$;

-- 5. Fulfillment summary -------------------------------------------------------
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
    COALESCE(SUM(total_price), 0)::numeric
  FROM public.orders
  WHERE cancelled_at IS NULL
    AND (p_from IS NULL OR shopify_created_at >= p_from)
    AND (p_store_id IS NULL OR store_id = p_store_id)
$$;

-- 6. Fulfillment trend (daily) -------------------------------------------------
-- unfulfilled = anything that is not fulfilled/partial (incl. NULL), matching the
-- old `fs = status ?? 'unfulfilled'; else map[day].unfulfilled++`.
CREATE OR REPLACE FUNCTION public.get_report_fulfillment_trend(
  p_from      timestamptz DEFAULT NULL,
  p_store_id  uuid        DEFAULT NULL
)
RETURNS TABLE (date date, fulfilled bigint, unfulfilled bigint, partial bigint)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    (shopify_created_at AT TIME ZONE 'UTC')::date  AS date,
    COUNT(*) FILTER (WHERE fulfillment_status = 'fulfilled')::bigint                               AS fulfilled,
    COUNT(*) FILTER (WHERE COALESCE(fulfillment_status, 'unfulfilled') NOT IN ('fulfilled','partial'))::bigint AS unfulfilled,
    COUNT(*) FILTER (WHERE fulfillment_status = 'partial')::bigint                                  AS partial
  FROM public.orders
  WHERE cancelled_at IS NULL
    AND (p_from IS NULL OR shopify_created_at >= p_from)
    AND (p_store_id IS NULL OR store_id = p_store_id)
  GROUP BY 1
  ORDER BY 1
$$;

-- 7. Collection performance ----------------------------------------------------
-- Groups by products.collection_id (the canonical primary collection FK), name
-- from collections; NULL collection -> 'Uncategorised'.
CREATE OR REPLACE FUNCTION public.get_report_collection_performance(
  p_from      timestamptz DEFAULT NULL,
  p_store_id  uuid        DEFAULT NULL
)
RETURNS TABLE (collection text, revenue numeric, units numeric)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    COALESCE(c.name, 'Uncategorised')                       AS collection,
    COALESCE(SUM(oi.quantity * oi.unit_price), 0)::numeric  AS revenue,
    COALESCE(SUM(oi.quantity), 0)::numeric                  AS units
  FROM public.order_items oi
  JOIN public.orders   o ON o.id = oi.order_id
  LEFT JOIN public.products    p ON p.id = oi.product_id
  LEFT JOIN public.collections c ON c.id = p.collection_id
  WHERE o.cancelled_at IS NULL
    AND (p_from IS NULL OR o.shopify_created_at >= p_from)
    AND (p_store_id IS NULL OR o.store_id = p_store_id)
  GROUP BY p.collection_id, c.name
  ORDER BY revenue DESC
$$;

-- 8. Revenue KPIs (current vs prior window) ------------------------------------
-- Caller supplies the prior window [p_prior_from, p_prior_to); revenueChange is
-- computed in JS from revenue + prior_revenue.
CREATE OR REPLACE FUNCTION public.get_report_revenue_kpis(
  p_from        timestamptz DEFAULT NULL,
  p_prior_from  timestamptz DEFAULT NULL,
  p_prior_to    timestamptz DEFAULT NULL,
  p_store_id    uuid        DEFAULT NULL
)
RETURNS TABLE (revenue numeric, orders bigint, aov numeric, prior_revenue numeric)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH cur AS (
    SELECT COALESCE(SUM(total_price), 0) AS revenue, COUNT(*) AS orders
    FROM public.orders
    WHERE cancelled_at IS NULL
      AND (p_from IS NULL OR shopify_created_at >= p_from)
      AND (p_store_id IS NULL OR store_id = p_store_id)
  ),
  prior AS (
    SELECT COALESCE(SUM(total_price), 0) AS revenue
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

-- Grants -----------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_report_sales_by_channel(timestamptz, uuid)            TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_report_sales_trend(timestamptz, uuid)                 TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_report_top_products(timestamptz, int, uuid)           TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_report_inventory_kpis(uuid)                           TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_report_fulfillment_summary(timestamptz, uuid)         TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_report_fulfillment_trend(timestamptz, uuid)           TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_report_collection_performance(timestamptz, uuid)      TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_report_revenue_kpis(timestamptz, timestamptz, timestamptz, uuid) TO authenticated, anon;
