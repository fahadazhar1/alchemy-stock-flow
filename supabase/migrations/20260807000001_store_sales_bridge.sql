-- Gross Sales -> Discounts -> Net Sales bridge for the P&L page. Returns is
-- deliberately NOT included: the `orders` table syncs total_discounts but has
-- no refund/return field at all (unlike the standalone monthly PDF report
-- scripts, which pull refund_line_items live from Shopify's REST API
-- directly, bypassing this table). Gross Sales here is DERIVED as
-- Net Sales + Discounts, not summed independently from a separate gross
-- field — this guarantees the bridge always reconciles exactly to the same
-- Net Sales figure the rest of the dashboard already shows (same principle
-- used in the monthly report scripts after the "two different totals" bug
-- found there in August 2026).
--
-- Same KSA-timezone-split pattern as get_store_period_channel_sales: KSA is
-- Asia/Riyadh (UTC+3), everything else assumes the caller passed Asia/Karachi
-- (UTC+5) bounds, so KSA's window is shifted +2h to match.

DROP FUNCTION IF EXISTS public.get_store_sales_bridge(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.get_store_sales_bridge(
  p_start_iso timestamptz,
  p_end_iso   timestamptz
)
RETURNS TABLE (
  store_id      uuid,
  net_sales     numeric, -- excl. shipping: SUM(current_total_price) - SUM(total_shipping_price)
  discounts     numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    store_id,
    COALESCE(SUM(current_total_price) FILTER (WHERE cancelled_at IS NULL), 0)
      - COALESCE(SUM(total_shipping_price) FILTER (WHERE cancelled_at IS NULL), 0),
    COALESCE(SUM(total_discounts) FILTER (WHERE cancelled_at IS NULL), 0)
  FROM public.orders
  WHERE shopify_created_at >= p_start_iso AND shopify_created_at <= p_end_iso
    AND store_id <> 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY store_id

  UNION ALL

  SELECT
    store_id,
    COALESCE(SUM(current_total_price) FILTER (WHERE cancelled_at IS NULL), 0)
      - COALESCE(SUM(total_shipping_price) FILTER (WHERE cancelled_at IS NULL), 0),
    COALESCE(SUM(total_discounts) FILTER (WHERE cancelled_at IS NULL), 0)
  FROM public.orders
  WHERE shopify_created_at >= (p_start_iso + interval '2 hours')
    AND shopify_created_at <= (p_end_iso + interval '2 hours')
    AND store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY store_id
$$;

GRANT EXECUTE ON FUNCTION public.get_store_sales_bridge(timestamptz, timestamptz) TO authenticated, anon;


-- Monthly Net Sales trend (last N months), same shipping-excluded basis, for
-- the P&L trend chart. Returns one row per store per calendar month within
-- the window the caller asks for.
DROP FUNCTION IF EXISTS public.get_monthly_net_sales_trend(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.get_monthly_net_sales_trend(
  p_start_iso timestamptz,
  p_end_iso   timestamptz
)
RETURNS TABLE (
  store_id    uuid,
  month_start date,
  net_sales   numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    store_id,
    date_trunc('month', shopify_created_at)::date,
    COALESCE(SUM(current_total_price) FILTER (WHERE cancelled_at IS NULL), 0)
      - COALESCE(SUM(total_shipping_price) FILTER (WHERE cancelled_at IS NULL), 0)
  FROM public.orders
  WHERE shopify_created_at >= p_start_iso AND shopify_created_at <= p_end_iso
    AND store_id <> 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY store_id, date_trunc('month', shopify_created_at)

  UNION ALL

  SELECT
    store_id,
    date_trunc('month', shopify_created_at + interval '2 hours')::date,
    COALESCE(SUM(current_total_price) FILTER (WHERE cancelled_at IS NULL), 0)
      - COALESCE(SUM(total_shipping_price) FILTER (WHERE cancelled_at IS NULL), 0)
  FROM public.orders
  WHERE shopify_created_at >= (p_start_iso + interval '2 hours')
    AND shopify_created_at <= (p_end_iso + interval '2 hours')
    AND store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY store_id, date_trunc('month', shopify_created_at + interval '2 hours')
$$;

GRANT EXECUTE ON FUNCTION public.get_monthly_net_sales_trend(timestamptz, timestamptz) TO authenticated, anon;
