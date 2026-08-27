-- Monthly net-sales aggregate for the CEO yearly Excel report, per store, with a
-- per-store wholesale/B2B order-value threshold excluded (order-level, so this
-- can't be built from get_store_period_channel_sales — needs its own grouping).
-- Net sales = current_total_price - total_shipping_price (net of shipping,
-- live/post-refund via current_total_price per the project-wide revenue rule).
-- Cancelled orders excluded. KSA gets the existing +2h Karachi->Riyadh shift
-- applied to both the range filter and the month bucket, same pattern as
-- get_store_period_channel_sales (20260803000004).

CREATE OR REPLACE FUNCTION public.get_monthly_net_sales(
  p_store_id            uuid,
  p_start_iso            timestamptz,
  p_end_iso              timestamptz,
  p_wholesale_threshold  numeric
)
RETURNS TABLE (
  month                     date,
  orders                    bigint,
  net_sales                 numeric,
  wholesale_excluded_orders bigint,
  wholesale_excluded_amount numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH shifted AS (
    SELECT
      date_trunc(
        'month',
        shopify_created_at + (CASE WHEN store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
                                    THEN interval '2 hours' ELSE interval '0' END)
      )::date AS bucket_month,
      current_total_price,
      total_shipping_price,
      cancelled_at
    FROM public.orders
    WHERE store_id = p_store_id
      AND shopify_created_at + (CASE WHEN store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
                                      THEN interval '2 hours' ELSE interval '0' END)
        >= p_start_iso + (CASE WHEN store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
                                THEN interval '2 hours' ELSE interval '0' END)
      AND shopify_created_at + (CASE WHEN store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
                                      THEN interval '2 hours' ELSE interval '0' END)
        <= p_end_iso + (CASE WHEN store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
                              THEN interval '2 hours' ELSE interval '0' END)
  )
  SELECT
    bucket_month,
    COUNT(*) FILTER (WHERE cancelled_at IS NULL AND current_total_price < p_wholesale_threshold),
    COALESCE(SUM(current_total_price - COALESCE(total_shipping_price, 0))
      FILTER (WHERE cancelled_at IS NULL AND current_total_price < p_wholesale_threshold), 0),
    COUNT(*) FILTER (WHERE cancelled_at IS NULL AND current_total_price >= p_wholesale_threshold),
    COALESCE(SUM(current_total_price - COALESCE(total_shipping_price, 0))
      FILTER (WHERE cancelled_at IS NULL AND current_total_price >= p_wholesale_threshold), 0)
  FROM shifted
  GROUP BY bucket_month
  ORDER BY bucket_month;
$$;

GRANT EXECUTE ON FUNCTION public.get_monthly_net_sales(uuid, timestamptz, timestamptz, numeric)
  TO authenticated, anon;
