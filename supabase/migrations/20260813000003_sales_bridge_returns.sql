-- Add returns_amount to the sales bridge RPC (bucketed by refund date, not
-- original order date — see order_refunds.sql) and a companion RPC for the
-- "View by channel" breakdown, mirroring the existing raw-source_name +
-- frontend normalizeKey()/CHANNEL_META pattern used everywhere else on the
-- dashboard (get_channel_performance, get_store_period_channel_sales) rather
-- than duplicating the channel-name mapping in SQL.
DROP FUNCTION IF EXISTS public.get_store_sales_bridge(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.get_store_sales_bridge(
  p_start_iso timestamptz,
  p_end_iso   timestamptz
)
RETURNS TABLE (
  store_id           uuid,
  net_sales          numeric, -- excl. shipping: SUM(current_total_price) - SUM(total_shipping_price)
  discounts          numeric,
  shipping_collected numeric,
  returns_amount     numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    o.store_id,
    COALESCE(SUM(o.current_total_price) FILTER (WHERE o.cancelled_at IS NULL), 0)
      - COALESCE(SUM(o.total_shipping_price) FILTER (WHERE o.cancelled_at IS NULL), 0),
    COALESCE(SUM(o.total_discounts) FILTER (WHERE o.cancelled_at IS NULL), 0),
    COALESCE(SUM(o.total_shipping_price) FILTER (WHERE o.cancelled_at IS NULL), 0),
    (SELECT COALESCE(SUM(r.amount), 0) FROM public.order_refunds r
       WHERE r.store_id = o.store_id AND r.refunded_at >= p_start_iso AND r.refunded_at <= p_end_iso)
  FROM public.orders o
  WHERE o.shopify_created_at >= p_start_iso AND o.shopify_created_at <= p_end_iso
    AND o.store_id <> 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY o.store_id

  UNION ALL

  SELECT
    o.store_id,
    COALESCE(SUM(o.current_total_price) FILTER (WHERE o.cancelled_at IS NULL), 0)
      - COALESCE(SUM(o.total_shipping_price) FILTER (WHERE o.cancelled_at IS NULL), 0),
    COALESCE(SUM(o.total_discounts) FILTER (WHERE o.cancelled_at IS NULL), 0),
    COALESCE(SUM(o.total_shipping_price) FILTER (WHERE o.cancelled_at IS NULL), 0),
    (SELECT COALESCE(SUM(r.amount), 0) FROM public.order_refunds r
       WHERE r.store_id = o.store_id
         AND r.refunded_at >= (p_start_iso + interval '2 hours')
         AND r.refunded_at <= (p_end_iso + interval '2 hours'))
  FROM public.orders o
  WHERE o.shopify_created_at >= (p_start_iso + interval '2 hours')
    AND o.shopify_created_at <= (p_end_iso + interval '2 hours')
    AND o.store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY o.store_id
$$;

GRANT EXECUTE ON FUNCTION public.get_store_sales_bridge(timestamptz, timestamptz) TO authenticated, anon;

-- Returns by channel — raw source_name, grouped, bucketed by refund date.
-- The single KSA store gets the same +2h shift as every other date-bucketed
-- RPC on this page.
CREATE OR REPLACE FUNCTION public.get_returns_by_channel(
  p_start_iso timestamptz,
  p_end_iso   timestamptz
)
RETURNS TABLE (
  store_id      uuid,
  source_name   text,
  refund_amount numeric,
  refund_count  bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT store_id, source_name, SUM(amount), COUNT(*)::bigint
  FROM public.order_refunds
  WHERE refunded_at >= p_start_iso AND refunded_at <= p_end_iso
    AND store_id <> 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY store_id, source_name

  UNION ALL

  SELECT store_id, source_name, SUM(amount), COUNT(*)::bigint
  FROM public.order_refunds
  WHERE refunded_at >= (p_start_iso + interval '2 hours')
    AND refunded_at <= (p_end_iso + interval '2 hours')
    AND store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY store_id, source_name
$$;

GRANT EXECUTE ON FUNCTION public.get_returns_by_channel(timestamptz, timestamptz) TO authenticated, anon;
