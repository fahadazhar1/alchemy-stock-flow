-- ── get_channel_performance ───────────────────────────────────────────────────
-- Server-side pre-aggregation for the useChannelPerformance hook.
--
-- HYBRID design (deliberate): the JS normalizeKey() function maps source_name to
-- a channel via ~17 substring rules, and the hook also builds a 14-day per-channel
-- sparkline. Translating normalizeKey into SQL would be high-risk, so this RPC
-- only does the cheap, safe part: group raw source_name by UTC day and SUM/COUNT.
-- The browser receives ~(distinct source_name × days) rows instead of ≤10k order
-- rows. The JS keeps normalizeKey + the sparkline logic verbatim.
--
-- Replication notes:
--  • Filter: cancelled_at IS NULL, period on shopify_created_at — identical.
--  • bucket_date = (shopify_created_at AT TIME ZONE 'UTC')::date — matches the old
--    JS toDateKey(new Date(shopify_created_at)) UTC date used for dailyMap keys.
--  • revenue = COALESCE(SUM(total_price),0) — addition is associative, so summing
--    per (source,date) then folding in JS equals the old per-row accumulation.
--    NULL total_price contributes 0 either way; the order is still COUNT(*)-ed.
--  • Raw source_name (incl. NULL) is returned untouched so JS normalizeKey can map
--    NULL/'' -> 'admin' exactly as before.
--  • No .limit cap (user-approved).

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
    (shopify_created_at AT TIME ZONE 'UTC')::date  AS bucket_date,
    COALESCE(SUM(total_price), 0)::numeric         AS revenue,
    COUNT(*)::bigint                               AS orders
  FROM public.orders
  WHERE shopify_created_at >= p_start_iso
    AND shopify_created_at <= p_end_iso
    AND cancelled_at IS NULL
    AND (p_store_id IS NULL OR store_id = p_store_id)
  GROUP BY source_name, 2
$$;

GRANT EXECUTE ON FUNCTION public.get_channel_performance(timestamptz, timestamptz, uuid)
  TO authenticated, anon;
