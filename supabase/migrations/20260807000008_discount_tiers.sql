-- Powers the click-to-expand "By discount tier" table on the Sales Bridge
-- card, mirroring the store's old Excel P&L tracker (No Discount / 5% /
-- 10% / .../ 35%+, Orders + Sales columns).
--
-- Per-order discount % must exclude shipping from both sides of the ratio
-- — confirmed on real UK orders that including shipping badly corrupts
-- the rate (e.g. a real 10%-off code came out as 8.55-9.40% depending on
-- shipping cost; excluding shipping gives exactly 10.00% every time).
-- Revenue per tier uses the same Net Sales basis (excl. shipping) as
-- everywhere else on this page.
--
-- Discount codes' names/amounts are NOT used to determine the rate —
-- Shopify stores the £ amount discounted, not the % — so the rate is
-- always computed from total_discounts vs. the order's own subtotal, then
-- rounded to the nearest 5% tier. This also correctly buckets discounts
-- with no code at all (manual/staff-applied), which computed cleanly on
-- real data (confirmed a genuine 35% and 20% this way).
CREATE OR REPLACE FUNCTION public.get_store_discount_tiers(
  p_start_iso timestamptz,
  p_end_iso   timestamptz
)
RETURNS TABLE (
  store_id uuid,
  tier     integer, -- 0 = No Discount, 5..30 = that tier, 35 = "35%+"
  orders   bigint,
  revenue  numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH per_order AS (
    SELECT
      store_id,
      current_total_price - total_shipping_price AS net_sales,
      CASE
        WHEN total_discounts <= 0 THEN 0
        ELSE LEAST(35, GREATEST(5, 5 * ROUND(
          (100 * total_discounts / NULLIF(current_total_price - total_shipping_price + total_discounts, 0)) / 5
        )))::integer
      END AS tier
    FROM public.orders
    WHERE cancelled_at IS NULL
      AND shopify_created_at >= p_start_iso AND shopify_created_at <= p_end_iso
      AND store_id <> 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid

    UNION ALL

    SELECT
      store_id,
      current_total_price - total_shipping_price,
      CASE
        WHEN total_discounts <= 0 THEN 0
        ELSE LEAST(35, GREATEST(5, 5 * ROUND(
          (100 * total_discounts / NULLIF(current_total_price - total_shipping_price + total_discounts, 0)) / 5
        )))::integer
      END
    FROM public.orders
    WHERE cancelled_at IS NULL
      AND shopify_created_at >= (p_start_iso + interval '2 hours')
      AND shopify_created_at <= (p_end_iso + interval '2 hours')
      AND store_id = 'b7a583c9-0098-44c4-8ad0-f47105facf40'::uuid
  )
  SELECT store_id, tier, COUNT(*), COALESCE(SUM(net_sales), 0)
  FROM per_order
  GROUP BY store_id, tier
$$;

GRANT EXECUTE ON FUNCTION public.get_store_discount_tiers(timestamptz, timestamptz) TO authenticated, anon;
