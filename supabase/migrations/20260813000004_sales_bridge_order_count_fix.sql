-- Fix: the previous migration (20260813000003) redefined get_store_sales_bridge
-- from an older copy of the function and accidentally dropped order_count,
-- which a later migration (20260807000006, "Is Marketing Paying Off?") had
-- already added and which the frontend depends on (bridgeSummary.orderCount,
-- shown as "N orders" on the Sales Bridge card and used by the Marketing ROI
-- card's cost/revenue-per-sale). Restoring it alongside shipping_collected
-- and returns_amount.
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
  returns_amount     numeric,
  order_count        bigint
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
       WHERE r.store_id = o.store_id AND r.refunded_at >= p_start_iso AND r.refunded_at <= p_end_iso),
    COUNT(*) FILTER (WHERE o.cancelled_at IS NULL)
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
         AND r.refunded_at <= (p_end_iso + interval '2 hours')),
    COUNT(*) FILTER (WHERE o.cancelled_at IS NULL)
  FROM public.orders o
  WHERE o.shopify_created_at >= (p_start_iso + interval '2 hours')
    AND o.shopify_created_at <= (p_end_iso + interval '2 hours')
    AND o.store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY o.store_id
$$;

GRANT EXECUTE ON FUNCTION public.get_store_sales_bridge(timestamptz, timestamptz) TO authenticated, anon;
