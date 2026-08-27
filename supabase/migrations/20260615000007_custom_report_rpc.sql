-- ── Custom report builder — generic aggregation RPC ──────────────────────────
-- Replaces the per-dimension branch logic in reportsEngine.runCustomReport with a
-- single static (injection-proof, no dynamic SQL) function. Computes all metrics
-- at once; the frontend displays the ones the user selected.
--
-- Grain: ORDER-LINE level (order_items ⋈ orders ⋈ products ⋈ vendors ⋈ collections).
-- This is the only grain where Product/Vendor/Collection dimensions are possible.
--
-- SEMANTICS (approved): "Revenue" = SUM(quantity * unit_price) — product-line
-- revenue, EXCLUDING shipping/discounts. Consistent across every dimension and
-- matches the Top Products / Collections reports; it will NOT equal the
-- shipping-inclusive Revenue KPI (same intentional gap as the Bundle KPI).
--
-- Behaviour matches the other v2 report RPCs: cancelled orders excluded,
-- shopify_created_at date basis, UTC day buckets.
--
-- Filters (p_filters jsonb, all optional): status, fulfillment, channel,
-- product_type (equality); min_revenue (HAVING). Unknown keys are ignored.

CREATE OR REPLACE FUNCTION public.get_custom_report(
  p_dimension text,
  p_filters   jsonb       DEFAULT '{}',
  p_from      timestamptz DEFAULT NULL,
  p_to        timestamptz DEFAULT NULL,
  p_store_id  uuid        DEFAULT NULL,
  p_limit     int         DEFAULT 100
)
RETURNS TABLE (dimension text, revenue numeric, units numeric, orders bigint, aov numeric)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT
    CASE p_dimension
      WHEN 'Channel'     THEN COALESCE(o.source_name, 'Unknown')
      WHEN 'Collection'  THEN COALESCE(c.name, 'Uncategorised')
      WHEN 'Product'     THEN COALESCE(p.name, 'Unknown')
      WHEN 'SKU'         THEN COALESCE(p.name, 'Unknown')
      WHEN 'Vendor'      THEN COALESCE(v.name, 'Unknown')
      WHEN 'Type'        THEN COALESCE(p.product_type, '—')
      WHEN 'Status'      THEN COALESCE(o.financial_status, 'unknown')
      WHEN 'Fulfillment' THEN COALESCE(o.fulfillment_status, 'unfulfilled')
      WHEN 'Day'         THEN to_char((o.shopify_created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')
      WHEN 'Week'        THEN to_char(date_trunc('week',  o.shopify_created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD')
      WHEN 'Month'       THEN to_char(date_trunc('month', o.shopify_created_at AT TIME ZONE 'UTC'), 'YYYY-MM')
      ELSE COALESCE(o.source_name, 'Unknown')
    END                                                                          AS dimension,
    COALESCE(SUM(oi.quantity * oi.unit_price), 0)::numeric                       AS revenue,
    COALESCE(SUM(oi.quantity), 0)::numeric                                       AS units,
    COUNT(DISTINCT oi.order_id)::bigint                                          AS orders,
    CASE WHEN COUNT(DISTINCT oi.order_id) > 0
         THEN (SUM(oi.quantity * oi.unit_price) / COUNT(DISTINCT oi.order_id))::numeric
         ELSE 0 END                                                              AS aov
  FROM public.order_items oi
  JOIN public.orders      o ON o.id = oi.order_id
  LEFT JOIN public.products    p ON p.id = oi.product_id
  LEFT JOIN public.vendors     v ON v.id = p.vendor_id
  LEFT JOIN public.collections c ON c.id = p.collection_id
  WHERE o.cancelled_at IS NULL
    AND (p_from IS NULL OR o.shopify_created_at >= p_from)
    AND (p_to   IS NULL OR o.shopify_created_at <  p_to)
    AND (p_store_id IS NULL OR o.store_id = p_store_id)
    AND (p_filters->>'status'       IS NULL OR o.financial_status   = p_filters->>'status')
    AND (p_filters->>'fulfillment'  IS NULL OR o.fulfillment_status = p_filters->>'fulfillment')
    AND (p_filters->>'channel'      IS NULL OR o.source_name        = p_filters->>'channel')
    AND (p_filters->>'product_type' IS NULL OR p.product_type       = p_filters->>'product_type')
  GROUP BY 1
  HAVING (p_filters->>'min_revenue' IS NULL
          OR SUM(oi.quantity * oi.unit_price) >= (p_filters->>'min_revenue')::numeric)
  ORDER BY revenue DESC
  LIMIT p_limit
$$;

GRANT EXECUTE ON FUNCTION public.get_custom_report(text, jsonb, timestamptz, timestamptz, uuid, int) TO authenticated, anon;
