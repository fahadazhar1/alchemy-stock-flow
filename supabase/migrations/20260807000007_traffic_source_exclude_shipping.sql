-- Fix: get_store_traffic_source summed current_total_price directly, which
-- includes shipping — inconsistent with "Net Sales" everywhere else on the
-- P&L page (Sales Bridge, KPI row), which explicitly excludes shipping.
-- Subtracting total_shipping_price here so these figures reconcile with
-- the rest of the page.
DROP FUNCTION IF EXISTS public.get_store_traffic_source(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.get_store_traffic_source(
  p_start_iso timestamptz,
  p_end_iso   timestamptz
)
RETURNS TABLE (
  store_id uuid,
  source   text, -- 'paid' | 'organic' | 'direct'
  orders   bigint,
  revenue  numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    store_id,
    CASE
      WHEN landing_site ~ '(gclid=|fbclid=|ttclid=|gbraid=|wbraid=)' THEN 'paid'
      WHEN referring_site IS NOT NULL AND referring_site != '' THEN 'organic'
      ELSE 'direct'
    END,
    COUNT(*),
    COALESCE(SUM(current_total_price), 0) - COALESCE(SUM(total_shipping_price), 0)
  FROM public.orders
  WHERE shopify_created_at >= p_start_iso AND shopify_created_at <= p_end_iso
    AND cancelled_at IS NULL
    AND (source_name = 'web' OR source_name IS NULL)
    AND store_id <> 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY store_id, 2

  UNION ALL

  SELECT
    store_id,
    CASE
      WHEN landing_site ~ '(gclid=|fbclid=|ttclid=|gbraid=|wbraid=)' THEN 'paid'
      WHEN referring_site IS NOT NULL AND referring_site != '' THEN 'organic'
      ELSE 'direct'
    END,
    COUNT(*),
    COALESCE(SUM(current_total_price), 0) - COALESCE(SUM(total_shipping_price), 0)
  FROM public.orders
  WHERE shopify_created_at >= (p_start_iso + interval '2 hours')
    AND shopify_created_at <= (p_end_iso + interval '2 hours')
    AND cancelled_at IS NULL
    AND (source_name = 'web' OR source_name IS NULL)
    AND store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY store_id, 2
$$;

GRANT EXECUTE ON FUNCTION public.get_store_traffic_source(timestamptz, timestamptz) TO authenticated, anon;
