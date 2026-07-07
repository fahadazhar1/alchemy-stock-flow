-- Barcode (= ISBN for books) + body-description word count, synced by shopify-sync-seo.
-- Word count is stored instead of the full description to keep rows small (egress).
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS description_word_count integer;

CREATE OR REPLACE VIEW v_seo_audit AS
SELECT
  vis.product_id,
  vis.product_name,
  vis.sku,
  vis.collection_name,
  vis.product_type,
  vis.vendor_name,
  vis.total_inventory,
  vis.store_id,
  p.meta_title,
  p.meta_description,
  p.image_alt_text,
  p.barcode,
  p.description_word_count
FROM v_product_inventory_summary vis
JOIN products p ON p.id = vis.product_id;
