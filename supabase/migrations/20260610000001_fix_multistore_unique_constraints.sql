-- Fix global unique constraints that break multi-store syncs.
-- Shopify product/variant IDs are store-local sequences — two stores can share the same numeric ID.
-- These constraints must be scoped to (id, store_id) pairs.

-- products: drop global unique on shopify_product_id, replace with store-scoped
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_shopify_product_id_key;
ALTER TABLE products ADD CONSTRAINT products_shopify_product_id_store_key
  UNIQUE (shopify_product_id, store_id);

-- variants: drop global unique on shopify_variant_id, replace with store-scoped
ALTER TABLE variants DROP CONSTRAINT IF EXISTS variants_shopify_variant_id_key;
ALTER TABLE variants ADD CONSTRAINT variants_shopify_variant_id_store_key
  UNIQUE (shopify_variant_id, store_id);

-- variants: allow negative inventory — Shopify permits overselling, so inventory_quantity
-- can legitimately go below 0. Showing the real value is more useful than clamping to 0.
ALTER TABLE variants DROP CONSTRAINT IF EXISTS variants_inventory_quantity_check;
