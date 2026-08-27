-- Add order_count to the monthly trend RPC so the Net Sales Trend chart can
-- offer a raw "Orders" view alongside the indexed "Net Sales" (%) view.
-- Order counts don't need FX conversion (unlike sales), so they can be shown
-- as plain numbers across stores without the indexed-to-100 growth trick.
DROP FUNCTION IF EXISTS public.get_monthly_net_sales_trend(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.get_monthly_net_sales_trend(
  p_start_iso timestamptz,
  p_end_iso   timestamptz
)
RETURNS TABLE (
  store_id    uuid,
  month_start date,
  net_sales   numeric,
  order_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    store_id,
    date_trunc('month', shopify_created_at)::date,
    COALESCE(SUM(current_total_price) FILTER (WHERE cancelled_at IS NULL), 0)
      - COALESCE(SUM(total_shipping_price) FILTER (WHERE cancelled_at IS NULL), 0),
    COUNT(*) FILTER (WHERE cancelled_at IS NULL)
  FROM public.orders
  WHERE shopify_created_at >= p_start_iso AND shopify_created_at <= p_end_iso
    AND store_id <> 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY store_id, date_trunc('month', shopify_created_at)

  UNION ALL

  SELECT
    store_id,
    date_trunc('month', shopify_created_at + interval '2 hours')::date,
    COALESCE(SUM(current_total_price) FILTER (WHERE cancelled_at IS NULL), 0)
      - COALESCE(SUM(total_shipping_price) FILTER (WHERE cancelled_at IS NULL), 0),
    COUNT(*) FILTER (WHERE cancelled_at IS NULL)
  FROM public.orders
  WHERE shopify_created_at >= (p_start_iso + interval '2 hours')
    AND shopify_created_at <= (p_end_iso + interval '2 hours')
    AND store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY store_id, date_trunc('month', shopify_created_at + interval '2 hours')
$$;

GRANT EXECUTE ON FUNCTION public.get_monthly_net_sales_trend(timestamptz, timestamptz) TO authenticated, anon;
