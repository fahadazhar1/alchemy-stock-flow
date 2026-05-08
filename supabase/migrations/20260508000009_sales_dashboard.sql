
-- ── product_collections junction table ───────────────────────────────────────
-- Needed because Shopify's sync uses many-to-many, not a direct FK on products
CREATE TABLE IF NOT EXISTS public.product_collections (
  product_id    uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, collection_id)
);
ALTER TABLE public.product_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.product_collections FOR ALL USING (true) WITH CHECK (true);

-- shopify_collection_id on collections (used by sync to look up by Shopify ID)
ALTER TABLE public.collections ADD COLUMN IF NOT EXISTS shopify_collection_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_shopify_id
  ON public.collections(shopify_collection_id) WHERE shopify_collection_id IS NOT NULL;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_product_collections_product_id    ON public.product_collections(product_id);
CREATE INDEX IF NOT EXISTS idx_product_collections_collection_id ON public.product_collections(collection_id);
CREATE INDEX IF NOT EXISTS idx_order_items_created_at            ON public.order_items(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_cancelled_at               ON public.orders(cancelled_at);

-- ── v_order_product_revenue ───────────────────────────────────────────────────
-- Denormalised view: one row per order-item with product metadata + order dates
-- Used by useTopProducts and useSalesTrend
CREATE OR REPLACE VIEW public.v_order_product_revenue AS
SELECT
  oi.id             AS order_item_id,
  oi.order_id,
  oi.product_id,
  p.name            AS product_name,
  p.sku,
  p.product_type,
  vn.name           AS vendor_name,
  oi.quantity,
  oi.unit_price,
  oi.quantity * oi.unit_price AS line_revenue,
  o.shopify_created_at        AS order_date,
  o.cancelled_at,
  o.source_name,
  o.store_id
FROM public.order_items oi
JOIN public.orders  o  ON o.id  = oi.order_id
JOIN public.products p ON p.id  = oi.product_id
LEFT JOIN public.vendors vn ON vn.id = p.vendor_id;

-- ── v_collection_revenue ──────────────────────────────────────────────────────
-- Per-order-item collection attribution via product_collections junction.
-- Used by useCollectionSales.
CREATE OR REPLACE VIEW public.v_collection_revenue AS
SELECT
  c.id              AS collection_id,
  c.name            AS collection_name,
  oi.product_id,
  oi.order_id,
  oi.quantity * oi.unit_price AS line_revenue,
  oi.quantity,
  o.shopify_created_at        AS order_date,
  o.cancelled_at,
  o.store_id
FROM public.order_items    oi
JOIN public.orders          o  ON o.id  = oi.order_id
JOIN public.product_collections pc ON pc.product_id = oi.product_id
JOIN public.collections     c  ON c.id  = pc.collection_id;
