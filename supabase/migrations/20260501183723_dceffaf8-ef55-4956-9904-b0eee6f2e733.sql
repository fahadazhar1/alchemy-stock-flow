
CREATE TABLE IF NOT EXISTS public.shopify_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  shop_domain text NOT NULL,
  access_token text,
  is_active boolean NOT NULL DEFAULT true,
  connected_at timestamptz DEFAULT now(),
  auto_sync_enabled boolean NOT NULL DEFAULT false,
  sync_frequency text NOT NULL DEFAULT '1hr',
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_records integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.shopify_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.shopify_connections FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.shopify_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid REFERENCES public.shopify_connections(id) ON DELETE CASCADE,
  store_id uuid,
  sync_time timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  records_synced integer NOT NULL DEFAULT 0,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.shopify_sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.shopify_sync_logs FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS shopify_product_id text;
ALTER TABLE public.variants ADD COLUMN IF NOT EXISTS shopify_variant_id text;
ALTER TABLE public.variants ADD COLUMN IF NOT EXISTS shopify_inventory_item_id text;

CREATE INDEX IF NOT EXISTS idx_products_shopify_id ON public.products(shopify_product_id);
CREATE INDEX IF NOT EXISTS idx_variants_shopify_id ON public.variants(shopify_variant_id);
CREATE INDEX IF NOT EXISTS idx_shopify_conn_store ON public.shopify_connections(store_id);

CREATE TRIGGER trg_shopify_conn_updated BEFORE UPDATE ON public.shopify_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
