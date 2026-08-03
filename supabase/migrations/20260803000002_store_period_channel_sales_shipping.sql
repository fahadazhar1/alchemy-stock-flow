-- Sales Pulse "exclude shipping" toggle needs a shipping_revenue aggregate
-- alongside the existing revenue/refunded_revenue columns, so the frontend
-- can subtract it without a second RPC round-trip.

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
  SELECT
    store_id,
    'cur'::text AS bucket,
    source_name,
    COUNT(*) FILTER (WHERE cancelled_at IS NULL)                        AS orders,
    COALESCE(SUM(total_price) FILTER (WHERE cancelled_at IS NULL), 0)   AS revenue,
    COUNT(*) FILTER (
      WHERE cancelled_at IS NULL AND financial_status IN ('refunded', 'partially_refunded')
    )                                                                    AS refunded_orders,
    COALESCE(SUM(total_price) FILTER (
      WHERE cancelled_at IS NULL AND financial_status IN ('refunded', 'partially_refunded')
    ), 0)                                                                AS refunded_revenue,
    COALESCE(SUM(total_shipping_price) FILTER (WHERE cancelled_at IS NULL), 0) AS shipping_revenue
  FROM public.orders
  WHERE shopify_created_at >= p_start_iso
    AND shopify_created_at <= p_end_iso
  GROUP BY store_id, source_name

  UNION ALL

  SELECT
    store_id,
    'prev'::text,
    source_name,
    COUNT(*) FILTER (WHERE cancelled_at IS NULL),
    COALESCE(SUM(total_price) FILTER (WHERE cancelled_at IS NULL), 0),
    COUNT(*) FILTER (
      WHERE cancelled_at IS NULL AND financial_status IN ('refunded', 'partially_refunded')
    ),
    COALESCE(SUM(total_price) FILTER (
      WHERE cancelled_at IS NULL AND financial_status IN ('refunded', 'partially_refunded')
    ), 0),
    COALESCE(SUM(total_shipping_price) FILTER (WHERE cancelled_at IS NULL), 0)
  FROM public.orders
  WHERE shopify_created_at >= p_prev_start_iso
    AND shopify_created_at <= p_prev_end_iso
  GROUP BY store_id, source_name
$$;

GRANT EXECUTE ON FUNCTION public.get_store_period_channel_sales(timestamptz, timestamptz, timestamptz, timestamptz)
  TO authenticated, anon;
