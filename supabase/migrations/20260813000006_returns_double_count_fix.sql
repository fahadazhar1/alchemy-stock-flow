-- Two fixes found live after shipping the Returns feature:
--
-- 1) Double-counting: current_total_price already reflects a refund the
--    moment it happens (Shopify recalculates it live), but the order stays
--    bucketed in ITS OWN creation month for Net Sales. So an order created
--    AND refunded within the same reporting window has its refund counted
--    TWICE — once implicitly via a lower current_total_price feeding Net
--    Sales, once explicitly via the Returns line. Only a refund whose
--    ORIGINAL order was created BEFORE this window started is genuinely new
--    information Net Sales doesn't already reflect for this period.
--    Confirmed live: 7 of 14 refunds in a test window were same-period,
--    accounting for ~£75,906 of a ~£76,240 total (one large pair of PK
--    Draft Order refunds dominated it).
--
-- 2) Those same 2 Draft Order refunds turned out, on inspection, to be
--    same-day-created-and-refunded orders with no customer email and
--    current_total_price = 0 — an internal/staff process, not a genuine
--    customer return. User confirmed: exclude ONLY these 2 specific refunds,
--    not a general rule (no broader pattern established, just these).
ALTER TABLE public.order_refunds ADD COLUMN excluded_from_reports boolean NOT NULL DEFAULT false;

UPDATE public.order_refunds SET excluded_from_reports = true
WHERE shopify_refund_id IN ('1077389754479', '1077314846831');

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
    (SELECT COALESCE(SUM(r.amount), 0)
       FROM public.order_refunds r
       JOIN public.orders ord ON ord.store_id = r.store_id AND ord.shopify_order_id = r.shopify_order_id
       WHERE r.store_id = o.store_id
         AND r.refunded_at >= p_start_iso AND r.refunded_at <= p_end_iso
         AND ord.shopify_created_at < p_start_iso
         AND NOT r.excluded_from_reports),
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
    (SELECT COALESCE(SUM(r.amount), 0)
       FROM public.order_refunds r
       JOIN public.orders ord ON ord.store_id = r.store_id AND ord.shopify_order_id = r.shopify_order_id
       WHERE r.store_id = o.store_id
         AND r.refunded_at >= (p_start_iso + interval '2 hours')
         AND r.refunded_at <= (p_end_iso + interval '2 hours')
         AND ord.shopify_created_at < (p_start_iso + interval '2 hours')
         AND NOT r.excluded_from_reports),
    COUNT(*) FILTER (WHERE o.cancelled_at IS NULL)
  FROM public.orders o
  WHERE o.shopify_created_at >= (p_start_iso + interval '2 hours')
    AND o.shopify_created_at <= (p_end_iso + interval '2 hours')
    AND o.store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY o.store_id
$$;

GRANT EXECUTE ON FUNCTION public.get_store_sales_bridge(timestamptz, timestamptz) TO authenticated, anon;

-- Returns by channel: same two fixes applied, so this always sums to the
-- same total as get_store_sales_bridge's returns_amount.
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
  SELECT r.store_id, r.source_name, SUM(r.amount), COUNT(*)::bigint
  FROM public.order_refunds r
  JOIN public.orders ord ON ord.store_id = r.store_id AND ord.shopify_order_id = r.shopify_order_id
  WHERE r.refunded_at >= p_start_iso AND r.refunded_at <= p_end_iso
    AND ord.shopify_created_at < p_start_iso
    AND NOT r.excluded_from_reports
    AND r.store_id <> 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY r.store_id, r.source_name

  UNION ALL

  SELECT r.store_id, r.source_name, SUM(r.amount), COUNT(*)::bigint
  FROM public.order_refunds r
  JOIN public.orders ord ON ord.store_id = r.store_id AND ord.shopify_order_id = r.shopify_order_id
  WHERE r.refunded_at >= (p_start_iso + interval '2 hours')
    AND r.refunded_at <= (p_end_iso + interval '2 hours')
    AND ord.shopify_created_at < (p_start_iso + interval '2 hours')
    AND NOT r.excluded_from_reports
    AND r.store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY r.store_id, r.source_name
$$;

GRANT EXECUTE ON FUNCTION public.get_returns_by_channel(timestamptz, timestamptz) TO authenticated, anon;
