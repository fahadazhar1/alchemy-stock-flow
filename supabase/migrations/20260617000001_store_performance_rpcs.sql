-- Egress reduction: collapse useStorePerformance's 8 raw-row queries into 4 aggregate RPCs.
-- Before: up to 450k rows/refresh (orders ×2 + product_revenue + inventory views + collection_revenue ×2).
-- After:  ~200 rows/refresh (per-store aggregates only).
-- All functions: STABLE SECURITY INVOKER, no data modified.

-- ─── 1. Per-store order + units aggregates ────────────────────────────────────

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
      SUM(total_price) FILTER (WHERE cancelled_at IS NULL)
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
      COUNT(*) FILTER (WHERE cancelled_at IS NULL)       AS prev_orders,
      SUM(total_price) FILTER (WHERE cancelled_at IS NULL) AS prev_revenue
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

GRANT EXECUTE ON FUNCTION get_store_sales_metrics(timestamptz,timestamptz,timestamptz,timestamptz)
  TO authenticated, anon;

-- ─── 2. Per-store daily unit counts (sparklines) ──────────────────────────────
-- Returns at most (stores × days) rows — e.g. 4 × 30 = 120 rows.

CREATE OR REPLACE FUNCTION get_store_daily_units(
  p_start_date date,
  p_end_date   date
)
RETURNS TABLE (
  store_id   uuid,
  order_date date,
  units      bigint
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT
    store_id,
    order_date,
    SUM(quantity)::bigint AS units
  FROM v_order_product_revenue
  WHERE order_date >= p_start_date
    AND order_date <= p_end_date
    AND cancelled_at IS NULL
  GROUP BY store_id, order_date;
$$;

GRANT EXECUTE ON FUNCTION get_store_daily_units(date, date)
  TO authenticated, anon;

-- ─── 3. Per-store inventory snapshot ─────────────────────────────────────────
-- Aggregates v_product_inventory_summary + v_dead_stock + v_replenishment_candidates.
-- Replaces 3 paginated loops that fetched up to 12k raw rows.

CREATE OR REPLACE FUNCTION get_store_inventory_snapshot()
RETURNS TABLE (
  store_id          uuid,
  active_skus       bigint,
  oos_skus          bigint,
  total_inventory   numeric,
  dead_stock_count  bigint,
  overstock_count   bigint,
  low_stock_count   bigint,
  critical_count    bigint
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  WITH inv AS (
    SELECT
      store_id,
      COUNT(*)                                       AS active_skus,
      COUNT(*) FILTER (WHERE total_inventory = 0)    AS oos_skus,
      SUM(total_inventory)                           AS total_inventory
    FROM v_product_inventory_summary
    WHERE product_status = 'active'
    GROUP BY store_id
  ),
  dead AS (
    SELECT
      store_id,
      COUNT(*)                                                                        AS dead_stock_count,
      COUNT(*) FILTER (WHERE dead_stock_status = 'Never Sold' AND total_units >= 50) AS overstock_count
    FROM v_dead_stock
    GROUP BY store_id
  ),
  replen AS (
    SELECT
      store_id,
      COUNT(*)                                                       AS low_stock_count,
      COUNT(*) FILTER (WHERE replenishment_status = 'Critical')      AS critical_count
    FROM v_replenishment_candidates
    GROUP BY store_id
  )
  SELECT
    COALESCE(i.store_id, d.store_id, r.store_id) AS store_id,
    COALESCE(i.active_skus,      0) AS active_skus,
    COALESCE(i.oos_skus,         0) AS oos_skus,
    COALESCE(i.total_inventory,  0) AS total_inventory,
    COALESCE(d.dead_stock_count, 0) AS dead_stock_count,
    COALESCE(d.overstock_count,  0) AS overstock_count,
    COALESCE(r.low_stock_count,  0) AS low_stock_count,
    COALESCE(r.critical_count,   0) AS critical_count
  FROM inv i
  FULL JOIN dead  d USING (store_id)
  FULL JOIN replen r USING (store_id);
$$;

GRANT EXECUTE ON FUNCTION get_store_inventory_snapshot()
  TO authenticated, anon;

-- ─── 4. Per-store collection revenue (current + prev period) ─────────────────
-- Replaces 2× v_collection_revenue queries with limit(50k) each.
-- Internal collections (Trending Now, All, Top Selling) excluded server-side.

CREATE OR REPLACE FUNCTION get_store_category_revenue(
  p_start_date date,
  p_end_date   date,
  p_prev_start date,
  p_prev_end   date
)
RETURNS TABLE (
  store_id        uuid,
  collection_name text,
  cur_revenue     numeric,
  cur_units       bigint,
  prev_revenue    numeric
)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  WITH cur AS (
    SELECT
      store_id,
      collection_name,
      SUM(line_revenue)     AS cur_revenue,
      SUM(quantity)::bigint AS cur_units
    FROM v_collection_revenue
    WHERE order_date    >= p_start_date
      AND order_date    <= p_end_date
      AND cancelled_at  IS NULL
      AND collection_name IS NOT NULL
      AND lower(collection_name) NOT IN ('trending now','all','top selling')
    GROUP BY store_id, collection_name
  ),
  prev AS (
    SELECT
      store_id,
      collection_name,
      SUM(line_revenue) AS prev_revenue
    FROM v_collection_revenue
    WHERE order_date    >= p_prev_start
      AND order_date    <= p_prev_end
      AND cancelled_at  IS NULL
      AND collection_name IS NOT NULL
      AND lower(collection_name) NOT IN ('trending now','all','top selling')
    GROUP BY store_id, collection_name
  )
  SELECT
    COALESCE(c.store_id,        p.store_id)        AS store_id,
    COALESCE(c.collection_name, p.collection_name) AS collection_name,
    COALESCE(c.cur_revenue, 0)                     AS cur_revenue,
    COALESCE(c.cur_units,   0)                     AS cur_units,
    COALESCE(p.prev_revenue, 0)                    AS prev_revenue
  FROM cur  c
  FULL JOIN prev p USING (store_id, collection_name);
$$;

GRANT EXECUTE ON FUNCTION get_store_category_revenue(date, date, date, date)
  TO authenticated, anon;
