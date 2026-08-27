-- ── get_deadstock_summary ─────────────────────────────────────────────────────
-- Server-side aggregation for useDeadstockSummary. Replaces a ≤10k-row scan of
-- v_dead_stock (3 cols, summed in JS) with 5 numbers. Pure read-only.
--
-- Replication notes vs the old JS:
--  • "Overstocked" = dead_stock_status = 'Never Sold' AND total_units >= 50.
--    Uses IS NOT DISTINCT FROM so NULL status is treated as NOT overstocked
--    (matches JS `status === 'Never Sold'`, where null !== 'Never Sold'), and the
--    dead-side NOT(...) stays a clean boolean instead of going NULL on null status.
--  • Everything not overstocked (incl. NULL status, or 'Never Sold' with <50 units)
--    falls to the dead-side totals — identical to the old if/else.
--  • totalProducts = COUNT(*) over the (store-filtered) view rows.

CREATE OR REPLACE FUNCTION public.get_deadstock_summary(
  p_store_id  uuid DEFAULT NULL
)
RETURNS TABLE (
  dead_units     numeric,
  dead_value     numeric,
  over_units     numeric,
  over_value     numeric,
  total_products bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    COALESCE(SUM(total_units)     FILTER (WHERE NOT is_over), 0)::numeric AS dead_units,
    COALESCE(SUM(inventory_value) FILTER (WHERE NOT is_over), 0)::numeric AS dead_value,
    COALESCE(SUM(total_units)     FILTER (WHERE is_over), 0)::numeric     AS over_units,
    COALESCE(SUM(inventory_value) FILTER (WHERE is_over), 0)::numeric     AS over_value,
    COUNT(*)::bigint                                                      AS total_products
  FROM (
    SELECT
      COALESCE(total_units, 0)     AS total_units,
      COALESCE(inventory_value, 0) AS inventory_value,
      (dead_stock_status IS NOT DISTINCT FROM 'Never Sold'
        AND COALESCE(total_units, 0) >= 50)                AS is_over
    FROM public.v_dead_stock
    WHERE (p_store_id IS NULL OR store_id = p_store_id)
  ) s
$$;

GRANT EXECUTE ON FUNCTION public.get_deadstock_summary(uuid)
  TO authenticated, anon;
