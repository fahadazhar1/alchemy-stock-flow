-- Cart abandonment for the P&L page. abandoned_checkouts is already synced
-- live from Shopify's /checkouts.json every 15 min (shopify-sync edge
-- function, stage 5) and cross-referenced against `orders` for recovery
-- (mark_recovered_checkouts RPC) — this migration only adds a read-side
-- aggregate RPC, no new sync.
--
-- completed_at IS NULL = not yet recovered within the 48h window that
-- mark_recovered_checkouts checks, i.e. still genuinely abandoned.
--
-- completed_online_orders excludes POS/draft orders (source_name web/null
-- only) — abandoned checkouts only ever happen on the online-store funnel,
-- so mixing in other channels would understate the abandonment rate.
--
-- Same KSA-timezone-split UNION ALL pattern as every other period RPC on
-- this page: KSA is Asia/Riyadh (UTC+3), everything else assumes the
-- caller passed Asia/Karachi (UTC+5) bounds, so KSA's window shifts +2h.

CREATE OR REPLACE FUNCTION public.get_store_checkout_abandonment(
  p_start_iso timestamptz,
  p_end_iso   timestamptz
)
RETURNS TABLE (
  store_id                uuid,
  abandoned_count         bigint,
  revenue_at_risk         numeric,
  completed_online_orders bigint,
  has_synced              boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH abandoned AS (
    SELECT store_id, COUNT(*) AS cnt, COALESCE(SUM(total_price), 0) AS revenue
    FROM public.abandoned_checkouts
    WHERE completed_at IS NULL
      AND created_at >= p_start_iso AND created_at <= p_end_iso
      AND store_id <> 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
    GROUP BY store_id

    UNION ALL

    SELECT store_id, COUNT(*), COALESCE(SUM(total_price), 0)
    FROM public.abandoned_checkouts
    WHERE completed_at IS NULL
      AND created_at >= (p_start_iso + interval '2 hours')
      AND created_at <= (p_end_iso + interval '2 hours')
      AND store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
    GROUP BY store_id
  ),
  completed AS (
    SELECT store_id, COUNT(*) AS cnt
    FROM public.orders
    WHERE cancelled_at IS NULL
      AND (source_name = 'web' OR source_name IS NULL)
      AND shopify_created_at >= p_start_iso AND shopify_created_at <= p_end_iso
      AND store_id <> 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
    GROUP BY store_id

    UNION ALL

    SELECT store_id, COUNT(*)
    FROM public.orders
    WHERE cancelled_at IS NULL
      AND (source_name = 'web' OR source_name IS NULL)
      AND shopify_created_at >= (p_start_iso + interval '2 hours')
      AND shopify_created_at <= (p_end_iso + interval '2 hours')
      AND store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
    GROUP BY store_id
  ),
  synced AS (
    SELECT DISTINCT store_id FROM public.abandoned_checkouts
  )
  SELECT
    s.id,
    COALESCE(a.cnt, 0)::bigint,
    COALESCE(a.revenue, 0),
    COALESCE(c.cnt, 0)::bigint,
    (sy.store_id IS NOT NULL)
  FROM public.stores s
  LEFT JOIN abandoned a ON a.store_id = s.id
  LEFT JOIN completed c ON c.store_id = s.id
  LEFT JOIN synced sy   ON sy.store_id = s.id
  WHERE s.is_active
$$;

GRANT EXECUTE ON FUNCTION public.get_store_checkout_abandonment(timestamptz, timestamptz) TO authenticated, anon;
