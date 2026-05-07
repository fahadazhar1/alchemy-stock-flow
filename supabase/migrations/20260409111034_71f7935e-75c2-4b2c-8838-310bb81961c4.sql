
-- 1) Create stores table
CREATE TABLE public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_name text NOT NULL,
  store_code text UNIQUE NOT NULL,
  platform text DEFAULT 'shopify',
  store_url text,
  shopify_store_id text,
  access_token text,
  is_active boolean NOT NULL DEFAULT true,
  connected_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.stores FOR ALL USING (true) WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_stores_updated_at
  BEFORE UPDATE ON public.stores
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Insert 3 demo stores
INSERT INTO public.stores (id, store_name, store_code, platform, store_url, is_active, connected_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Dubai Mall Flagship', 'dubai-mall', 'shopify', 'https://dubai-mall.myshopify.com', true, now()),
  ('a0000000-0000-0000-0000-000000000002', 'Abu Dhabi Marina', 'abudhabi-marina', 'shopify', 'https://abudhabi-marina.myshopify.com', true, now()),
  ('a0000000-0000-0000-0000-000000000003', 'Sharjah Outlet', 'sharjah-outlet', 'shopify', 'https://sharjah-outlet.myshopify.com', true, now());

-- 3) Add store_id to all business tables
ALTER TABLE public.products ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.variants ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.orders ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.order_items ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.pricing_campaigns ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.pricing_campaign_items ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.inventory_sync_logs ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.product_velocity_metrics ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.simulation_logs ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.inventory_batches ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.ai_recommendations ADD COLUMN store_id uuid REFERENCES public.stores(id);

-- 4) Assign existing data to store 1 (Dubai Mall)
UPDATE public.products SET store_id = 'a0000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;
UPDATE public.variants SET store_id = 'a0000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;
UPDATE public.orders SET store_id = 'a0000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;
UPDATE public.order_items SET store_id = 'a0000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;
UPDATE public.pricing_campaigns SET store_id = 'a0000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;
UPDATE public.pricing_campaign_items SET store_id = 'a0000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;
UPDATE public.inventory_sync_logs SET store_id = 'a0000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;
UPDATE public.product_velocity_metrics SET store_id = 'a0000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;
UPDATE public.simulation_logs SET store_id = 'a0000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;
UPDATE public.inventory_batches SET store_id = 'a0000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;
UPDATE public.ai_recommendations SET store_id = 'a0000000-0000-0000-0000-000000000001' WHERE store_id IS NULL;

-- 5) Now distribute ~30% of products to store 2 and ~20% to store 3
-- We'll reassign by using modular arithmetic on the product name hash
UPDATE public.products SET store_id = 'a0000000-0000-0000-0000-000000000002'
WHERE id IN (SELECT id FROM public.products ORDER BY id LIMIT (SELECT COUNT(*) * 3 / 10 FROM public.products) OFFSET (SELECT COUNT(*) * 5 / 10 FROM public.products));

UPDATE public.products SET store_id = 'a0000000-0000-0000-0000-000000000003'
WHERE id IN (SELECT id FROM public.products ORDER BY id LIMIT (SELECT COUNT(*) * 2 / 10 FROM public.products) OFFSET (SELECT COUNT(*) * 8 / 10 FROM public.products));

-- Cascade store_id to variants based on their product
UPDATE public.variants v SET store_id = p.store_id FROM public.products p WHERE v.product_id = p.id;

-- Cascade to order_items based on product
UPDATE public.order_items oi SET store_id = p.store_id FROM public.products p WHERE oi.product_id = p.id;

-- Cascade orders based on their items (use first item's store)
UPDATE public.orders o SET store_id = (SELECT oi.store_id FROM public.order_items oi WHERE oi.order_id = o.id LIMIT 1) WHERE store_id = 'a0000000-0000-0000-0000-000000000001';

-- Cascade velocity metrics
UPDATE public.product_velocity_metrics pvm SET store_id = p.store_id FROM public.products p WHERE pvm.product_id = p.id;

-- Cascade AI recommendations
UPDATE public.ai_recommendations ar SET store_id = p.store_id FROM public.products p WHERE ar.product_id = p.id;

-- Cascade inventory batches
UPDATE public.inventory_batches ib SET store_id = v.store_id FROM public.variants v WHERE ib.variant_id = v.id;

-- 6) Create indexes
CREATE INDEX idx_products_store_id ON public.products(store_id);
CREATE INDEX idx_variants_store_id ON public.variants(store_id);
CREATE INDEX idx_orders_store_id ON public.orders(store_id);
CREATE INDEX idx_pricing_campaigns_store_id ON public.pricing_campaigns(store_id);
CREATE INDEX idx_inventory_sync_logs_store_id ON public.inventory_sync_logs(store_id);
CREATE INDEX idx_product_velocity_metrics_store_id ON public.product_velocity_metrics(store_id);
CREATE INDEX idx_simulation_logs_store_id ON public.simulation_logs(store_id);
CREATE INDEX idx_ai_recommendations_store_id ON public.ai_recommendations(store_id);
CREATE INDEX idx_inventory_batches_store_id ON public.inventory_batches(store_id);
CREATE INDEX idx_order_items_store_id ON public.order_items(store_id);
