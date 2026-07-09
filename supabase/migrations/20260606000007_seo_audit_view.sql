-- v_seo_audit: joins v_product_inventory_summary with products SEO columns
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
  p.image_alt_text
FROM v_product_inventory_summary vis
JOIN products p ON p.id = vis.product_id;
