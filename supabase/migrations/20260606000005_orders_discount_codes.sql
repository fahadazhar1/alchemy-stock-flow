-- Add discount_codes JSONB to orders (sync already writes this field, column was missing)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS discount_codes JSONB;

-- Per-code discount performance view: unnests discount_codes array to row-per-code
CREATE OR REPLACE VIEW v_discount_code_performance AS
SELECT
  dc->>'code'                              AS discount_code,
  dc->>'type'                              AS discount_type,
  o.store_id,
  COUNT(*)::int                            AS usage_count,
  COALESCE(SUM(o.total_price), 0)          AS total_revenue,
  COALESCE(SUM(o.total_discounts), 0)      AS total_discount_given,
  ROUND(AVG(o.total_price)::numeric, 2)    AS avg_order_value,
  MIN(o.shopify_created_at)                AS first_used_at,
  MAX(o.shopify_created_at)                AS last_used_at
FROM orders o,
  LATERAL jsonb_array_elements(o.discount_codes) AS dc
WHERE o.cancelled_at IS NULL
  AND o.discount_codes IS NOT NULL
  AND jsonb_array_length(o.discount_codes) > 0
GROUP BY dc->>'code', dc->>'type', o.store_id
ORDER BY usage_count DESC;
