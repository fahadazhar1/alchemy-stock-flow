-- Allow order line items whose product/variant was deleted in Shopify.
--
-- Problem: order_items.product_id and variant_id were NOT NULL FKs. When a
-- product is deleted in Shopify the sync cannot resolve the (now-gone) variant,
-- so it dropped the line entirely. The order header (total_price) still saved,
-- but order_items rows vanished — so any revenue/units aggregation built on
-- order_items under-reported real sales (e.g. UK last-7d was ~£150 short across
-- 3 deleted-product orders: #7223, #7186, #7179).
--
-- Fix: make product_id / variant_id nullable so orphaned lines can be stored
-- with the data Shopify still gives us (title, price, quantity). Aggregations
-- that inner-join products simply skip these (product-specific reports are
-- unaffected); revenue/units sums now reconcile. The collection report buckets
-- them as 'Uncategorised'. A `title` column preserves what was sold.

ALTER TABLE public.order_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.order_items ALTER COLUMN variant_id DROP NOT NULL;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS title text;
