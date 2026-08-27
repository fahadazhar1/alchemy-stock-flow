-- Shipping collected, broken down by channel — same convention as
-- get_returns_by_channel: raw source_name, frontend applies
-- normalizeKey()/CHANNEL_META. Powers the new standalone "Shipping
-- Collected" card's "View by channel" table.
CREATE OR REPLACE FUNCTION public.get_shipping_by_channel(
  p_start_iso timestamptz,
  p_end_iso   timestamptz
)
RETURNS TABLE (
  store_id         uuid,
  source_name      text,
  shipping_amount  numeric,
  order_count      bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT store_id, source_name, COALESCE(SUM(total_shipping_price), 0), COUNT(*)::bigint
  FROM public.orders
  WHERE shopify_created_at >= p_start_iso AND shopify_created_at <= p_end_iso
    AND cancelled_at IS NULL
    AND store_id <> 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY store_id, source_name

  UNION ALL

  SELECT store_id, source_name, COALESCE(SUM(total_shipping_price), 0), COUNT(*)::bigint
  FROM public.orders
  WHERE shopify_created_at >= (p_start_iso + interval '2 hours')
    AND shopify_created_at <= (p_end_iso + interval '2 hours')
    AND cancelled_at IS NULL
    AND store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY store_id, source_name
$$;

GRANT EXECUTE ON FUNCTION public.get_shipping_by_channel(timestamptz, timestamptz) TO authenticated, anon;
