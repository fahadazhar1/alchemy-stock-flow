-- Two fixes to Sales Pulse, found by cross-checking the dashboard against the
-- standalone sales-pulse-report.mjs script (which pulls live from Shopify):
--
-- 1. revenue now sums current_total_price instead of total_price. total_price
--    is frozen at order creation; current_total_price is live and already
--    nets out refunds/partial-refunds/edits. refunded_orders/refunded_revenue
--    are kept for backward-compat / potential display use, but the frontend
--    no longer subtracts them from revenue (current_total_price already has
--    that baked in) — see useStoreSalesPulse.ts.
--
-- 2. KSA's store timezone is Asia/Riyadh (UTC+3), but the frontend computes
--    ONE shared set of UTC day-boundaries for ALL stores using Asia/Karachi
--    (UTC+5) — a page-level default, not per-store. Karachi is 2 hours ahead
--    of Riyadh, so a Karachi-midnight boundary is actually 22:00 the previous
--    day in Riyadh, silently shifting KSA's late-evening orders into the next
--    calendar day. Rather than rework the whole app's shared date-bounds
--    architecture, this RPC shifts ONLY the KSA store's window by +2 hours,
--    converting the incoming Karachi-based bounds into the Riyadh-equivalent
--    window for that store. KSA is split into its own branch (constant bounds,
--    not a per-row CASE) so the other 3 stores keep a plain, index-friendly
--    range scan on shopify_created_at — a per-row-conditional boundary would
--    defeat that for every store, not just KSA. If a future store needs a
--    different offset again, generalize this into a
--    stores.timezone_offset_hours column instead of hardcoding another id.

DROP FUNCTION IF EXISTS public.get_store_period_channel_sales(timestamptz, timestamptz, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.get_store_period_channel_sales(
  p_start_iso      timestamptz,
  p_end_iso        timestamptz,
  p_prev_start_iso timestamptz,
  p_prev_end_iso   timestamptz
)
RETURNS TABLE (
  store_id         uuid,
  bucket           text,       -- 'cur' | 'prev'
  source_name      text,
  orders           bigint,
  revenue          numeric,
  refunded_orders  bigint,
  refunded_revenue numeric,
  shipping_revenue numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  -- Non-KSA stores: plain constant-bound range scan (index-friendly).
  SELECT
    store_id, 'cur'::text, source_name,
    COUNT(*) FILTER (WHERE cancelled_at IS NULL),
    COALESCE(SUM(current_total_price) FILTER (WHERE cancelled_at IS NULL), 0),
    COUNT(*) FILTER (WHERE cancelled_at IS NULL AND financial_status IN ('refunded', 'partially_refunded')),
    COALESCE(SUM(current_total_price) FILTER (WHERE cancelled_at IS NULL AND financial_status IN ('refunded', 'partially_refunded')), 0),
    COALESCE(SUM(total_shipping_price) FILTER (WHERE cancelled_at IS NULL), 0)
  FROM public.orders
  WHERE shopify_created_at >= p_start_iso AND shopify_created_at <= p_end_iso
    AND store_id <> 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY store_id, source_name

  UNION ALL

  SELECT
    store_id, 'prev'::text, source_name,
    COUNT(*) FILTER (WHERE cancelled_at IS NULL),
    COALESCE(SUM(current_total_price) FILTER (WHERE cancelled_at IS NULL), 0),
    COUNT(*) FILTER (WHERE cancelled_at IS NULL AND financial_status IN ('refunded', 'partially_refunded')),
    COALESCE(SUM(current_total_price) FILTER (WHERE cancelled_at IS NULL AND financial_status IN ('refunded', 'partially_refunded')), 0),
    COALESCE(SUM(total_shipping_price) FILTER (WHERE cancelled_at IS NULL), 0)
  FROM public.orders
  WHERE shopify_created_at >= p_prev_start_iso AND shopify_created_at <= p_prev_end_iso
    AND store_id <> 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY store_id, source_name

  UNION ALL

  -- KSA only: bounds shifted +2h (Karachi UTC+5 -> Riyadh UTC+3 equivalent window).
  SELECT
    store_id, 'cur'::text, source_name,
    COUNT(*) FILTER (WHERE cancelled_at IS NULL),
    COALESCE(SUM(current_total_price) FILTER (WHERE cancelled_at IS NULL), 0),
    COUNT(*) FILTER (WHERE cancelled_at IS NULL AND financial_status IN ('refunded', 'partially_refunded')),
    COALESCE(SUM(current_total_price) FILTER (WHERE cancelled_at IS NULL AND financial_status IN ('refunded', 'partially_refunded')), 0),
    COALESCE(SUM(total_shipping_price) FILTER (WHERE cancelled_at IS NULL), 0)
  FROM public.orders
  WHERE shopify_created_at >= (p_start_iso + interval '2 hours')
    AND shopify_created_at <= (p_end_iso + interval '2 hours')
    AND store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY store_id, source_name

  UNION ALL

  SELECT
    store_id, 'prev'::text, source_name,
    COUNT(*) FILTER (WHERE cancelled_at IS NULL),
    COALESCE(SUM(current_total_price) FILTER (WHERE cancelled_at IS NULL), 0),
    COUNT(*) FILTER (WHERE cancelled_at IS NULL AND financial_status IN ('refunded', 'partially_refunded')),
    COALESCE(SUM(current_total_price) FILTER (WHERE cancelled_at IS NULL AND financial_status IN ('refunded', 'partially_refunded')), 0),
    COALESCE(SUM(total_shipping_price) FILTER (WHERE cancelled_at IS NULL), 0)
  FROM public.orders
  WHERE shopify_created_at >= (p_prev_start_iso + interval '2 hours')
    AND shopify_created_at <= (p_prev_end_iso + interval '2 hours')
    AND store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY store_id, source_name
$$;

GRANT EXECUTE ON FUNCTION public.get_store_period_channel_sales(timestamptz, timestamptz, timestamptz, timestamptz)
  TO authenticated, anon;
