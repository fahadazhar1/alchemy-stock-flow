-- Expose shopify_product_id so the UI can deep-link straight to the Shopify admin product editor.
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
  p.description_word_count,
  p.shopify_product_id
FROM v_product_inventory_summary vis
JOIN products p ON p.id = vis.product_id;
