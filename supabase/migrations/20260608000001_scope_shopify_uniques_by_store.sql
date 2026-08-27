-- Shopify identifiers are only unique inside a single shop.
-- Scope them by store so newly connected stores can sync rows without
-- colliding on the same Shopify IDs used by other stores.
-- Note: we scope only on Shopify's native IDs (shopify_product_id,
-- shopify_variant_id, shopify_order_id) — NOT on SKU/variant_sku/order_number
-- because those are merchant-controlled and commonly duplicated across stores.

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_sku_key;

ALTER TABLE public.variants
  DROP CONSTRAINT IF EXISTS variants_variant_sku_key;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_order_number_key;

-- Only enforce uniqueness on Shopify's own IDs scoped per store
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_store_shopify_product_id_unique
  ON public.products(store_id, shopify_product_id)
  WHERE store_id IS NOT NULL AND shopify_product_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_store_shopify_variant_id_unique
  ON public.variants(store_id, shopify_variant_id)
  WHERE store_id IS NOT NULL AND shopify_variant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_store_shopify_order_id_unique
  ON public.orders(store_id, shopify_order_id)
  WHERE store_id IS NOT NULL AND shopify_order_id IS NOT NULL;
