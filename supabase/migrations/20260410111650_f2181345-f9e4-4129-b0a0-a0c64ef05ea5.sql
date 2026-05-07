
-- Master product catalog
CREATE TABLE public.master_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.master_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.master_products FOR ALL USING (true) WITH CHECK (true);

-- Master variant / SKU registry
CREATE TABLE public.master_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL REFERENCES public.master_products(id) ON DELETE CASCADE,
  sku text UNIQUE NOT NULL,
  base_price numeric(12,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.master_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.master_variants FOR ALL USING (true) WITH CHECK (true);

-- Central inventory — single source of truth
CREATE TABLE public.inventory_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_variant_id uuid NOT NULL REFERENCES public.master_variants(id) ON DELETE CASCADE,
  available_quantity integer NOT NULL DEFAULT 0,
  reserved_quantity integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (master_variant_id)
);
ALTER TABLE public.inventory_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.inventory_levels FOR ALL USING (true) WITH CHECK (true);

-- Store ↔ master variant mapping
CREATE TABLE public.store_variant_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.variants(id) ON DELETE CASCADE,
  master_variant_id uuid NOT NULL REFERENCES public.master_variants(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (store_id, variant_id)
);
ALTER TABLE public.store_variant_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.store_variant_mappings FOR ALL USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX idx_master_variants_master_product_id ON public.master_variants(master_product_id);
CREATE INDEX idx_inventory_levels_master_variant_id ON public.inventory_levels(master_variant_id);
CREATE INDEX idx_store_variant_mappings_store_id ON public.store_variant_mappings(store_id);
CREATE INDEX idx_store_variant_mappings_master_variant_id ON public.store_variant_mappings(master_variant_id);
CREATE INDEX idx_store_variant_mappings_variant_id ON public.store_variant_mappings(variant_id);

-- Updated_at triggers
CREATE TRIGGER update_master_products_updated_at
  BEFORE UPDATE ON public.master_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_master_variants_updated_at
  BEFORE UPDATE ON public.master_variants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_inventory_levels_updated_at
  BEFORE UPDATE ON public.inventory_levels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Helper view: central inventory with SKU details
CREATE OR REPLACE VIEW public.v_central_inventory AS
SELECT
  mv.id AS master_variant_id,
  mv.sku,
  mv.base_price,
  mp.id AS master_product_id,
  mp.name AS master_product_name,
  il.available_quantity,
  il.reserved_quantity,
  il.available_quantity - il.reserved_quantity AS net_available,
  (SELECT count(*) FROM public.store_variant_mappings svm WHERE svm.master_variant_id = mv.id) AS linked_stores_count
FROM public.master_variants mv
JOIN public.master_products mp ON mp.id = mv.master_product_id
LEFT JOIN public.inventory_levels il ON il.master_variant_id = mv.id;
