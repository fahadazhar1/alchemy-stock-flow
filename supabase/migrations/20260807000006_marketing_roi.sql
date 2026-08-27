-- Powers the "Is Marketing Paying Off?" card: adds order_count to the
-- existing sales bridge RPC so Cost/Revenue-per-Sale can be computed
-- client-side (ad spend and net sales are already available there).
DROP FUNCTION IF EXISTS public.get_store_sales_bridge(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.get_store_sales_bridge(
  p_start_iso timestamptz,
  p_end_iso   timestamptz
)
RETURNS TABLE (
  store_id    uuid,
  net_sales   numeric,
  discounts   numeric,
  order_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    store_id,
    COALESCE(SUM(current_total_price) FILTER (WHERE cancelled_at IS NULL), 0)
      - COALESCE(SUM(total_shipping_price) FILTER (WHERE cancelled_at IS NULL), 0),
    COALESCE(SUM(total_discounts) FILTER (WHERE cancelled_at IS NULL), 0),
    COUNT(*) FILTER (WHERE cancelled_at IS NULL)
  FROM public.orders
  WHERE shopify_created_at >= p_start_iso AND shopify_created_at <= p_end_iso
    AND store_id <> 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY store_id

  UNION ALL

  SELECT
    store_id,
    COALESCE(SUM(current_total_price) FILTER (WHERE cancelled_at IS NULL), 0)
      - COALESCE(SUM(total_shipping_price) FILTER (WHERE cancelled_at IS NULL), 0),
    COALESCE(SUM(total_discounts) FILTER (WHERE cancelled_at IS NULL), 0),
    COUNT(*) FILTER (WHERE cancelled_at IS NULL)
  FROM public.orders
  WHERE shopify_created_at >= (p_start_iso + interval '2 hours')
    AND shopify_created_at <= (p_end_iso + interval '2 hours')
    AND store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY store_id
$$;

GRANT EXECUTE ON FUNCTION public.get_store_sales_bridge(timestamptz, timestamptz) TO authenticated, anon;

-- Powers "Where Your Sales Really Come From": classifies each online-store
-- order as paid/organic/direct using the landing_site query string.
--
-- "Paid" requires an actual ad-click identifier (gclid/fbclid/ttclid/
-- gbraid/wbraid) — NOT just utm_source=google, because Shopify's free
-- Google Shopping listing sync also stamps utm_source=google&utm_medium=
-- product_sync&utm_campaign=sag_organic on completely free traffic
-- (confirmed on real UK order data before writing this — a naive
-- utm_source check would have wrongly counted free listings as paid ads).
--
-- Scoped to source_name IN ('web', NULL) only — same scope as
-- get_store_checkout_abandonment's completed_online_orders. POS/draft/
-- marketplace orders (Amazon, eBay, TikTok Shop) never have a browser
-- session at all, so lumping them into "Direct" would badly inflate it
-- (confirmed live: draft orders alone were 24% of what "Direct" would have
-- shown for UK in July 2026 before this scope was added).
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
    COALESCE(SUM(current_total_price), 0)
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
    COALESCE(SUM(current_total_price), 0)
  FROM public.orders
  WHERE shopify_created_at >= (p_start_iso + interval '2 hours')
    AND shopify_created_at <= (p_end_iso + interval '2 hours')
    AND cancelled_at IS NULL
    AND (source_name = 'web' OR source_name IS NULL)
    AND store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  GROUP BY store_id, 2
$$;

GRANT EXECUTE ON FUNCTION public.get_store_traffic_source(timestamptz, timestamptz) TO authenticated, anon;
