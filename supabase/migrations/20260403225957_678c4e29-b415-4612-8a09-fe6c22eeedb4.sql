
-- Enable pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

------------------------------------------------------------
-- 1) ROLE ENUM & USER_ROLES
------------------------------------------------------------
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'viewer');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.user_roles FOR ALL USING (true) WITH CHECK (true);

-- Security definer function for role checks
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

------------------------------------------------------------
-- 2) APP SETTINGS
------------------------------------------------------------
CREATE TABLE public.app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text UNIQUE NOT NULL,
  setting_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.app_settings FOR ALL USING (true) WITH CHECK (true);

------------------------------------------------------------
-- 3) COLLECTIONS
------------------------------------------------------------
CREATE TABLE public.collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.collections FOR ALL USING (true) WITH CHECK (true);

------------------------------------------------------------
-- 4) VENDORS
------------------------------------------------------------
CREATE TABLE public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.vendors FOR ALL USING (true) WITH CHECK (true);

------------------------------------------------------------
-- 5) TAGS
------------------------------------------------------------
CREATE TABLE public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.tags FOR ALL USING (true) WITH CHECK (true);

------------------------------------------------------------
-- 6) PRODUCTS
------------------------------------------------------------
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  sku text UNIQUE NOT NULL,
  vendor_id uuid REFERENCES public.vendors(id),
  collection_id uuid REFERENCES public.collections(id),
  product_type text,
  status text DEFAULT 'active' NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.products FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_products_vendor_id ON public.products(vendor_id);
CREATE INDEX idx_products_collection_id ON public.products(collection_id);
CREATE INDEX idx_products_created_at ON public.products(created_at);
CREATE INDEX idx_products_status ON public.products(status);

------------------------------------------------------------
-- 7) VARIANTS
------------------------------------------------------------
CREATE TABLE public.variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_sku text UNIQUE NOT NULL,
  size text NOT NULL,
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  compare_at_price numeric(12,2) CHECK (compare_at_price >= 0),
  inventory_quantity integer NOT NULL DEFAULT 0 CHECK (inventory_quantity >= 0),
  committed_quantity integer NOT NULL DEFAULT 0 CHECK (committed_quantity >= 0),
  campaign_name text CHECK (campaign_name IS NULL OR length(trim(campaign_name)) > 0),
  last_discounted_at timestamptz,
  expiry_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.variants FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_variants_product_id ON public.variants(product_id);
CREATE INDEX idx_variants_size ON public.variants(size);
CREATE INDEX idx_variants_campaign_name ON public.variants(campaign_name);
CREATE INDEX idx_variants_compare_at_price ON public.variants(compare_at_price);
CREATE INDEX idx_variants_inventory_quantity ON public.variants(inventory_quantity);
CREATE INDEX idx_variants_committed_quantity ON public.variants(committed_quantity);
CREATE INDEX idx_variants_expiry_date ON public.variants(expiry_date);
CREATE INDEX idx_variants_updated_at ON public.variants(updated_at);

------------------------------------------------------------
-- 8) PRODUCT_TAGS
------------------------------------------------------------
CREATE TABLE public.product_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(product_id, tag_id)
);
ALTER TABLE public.product_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.product_tags FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_product_tags_product_id ON public.product_tags(product_id);
CREATE INDEX idx_product_tags_tag_id ON public.product_tags(tag_id);

------------------------------------------------------------
-- 9) INVENTORY_SYNC_LOGS
------------------------------------------------------------
CREATE TABLE public.inventory_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL,
  campaign_name text,
  items_affected integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.inventory_sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.inventory_sync_logs FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_inventory_sync_logs_action_type ON public.inventory_sync_logs(action_type);
CREATE INDEX idx_inventory_sync_logs_status ON public.inventory_sync_logs(status);
CREATE INDEX idx_inventory_sync_logs_created_at ON public.inventory_sync_logs(created_at DESC);

------------------------------------------------------------
-- 10) PRODUCT_VELOCITY_METRICS
------------------------------------------------------------
CREATE TABLE public.product_velocity_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL UNIQUE REFERENCES public.products(id) ON DELETE CASCADE,
  units_sold_7d integer NOT NULL DEFAULT 0,
  units_sold_14d integer NOT NULL DEFAULT 0,
  units_sold_21d integer NOT NULL DEFAULT 0,
  units_sold_30d integer NOT NULL DEFAULT 0,
  last_sale_at timestamptz,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.product_velocity_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.product_velocity_metrics FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_pvm_last_sale_at ON public.product_velocity_metrics(last_sale_at);
CREATE INDEX idx_pvm_updated_at ON public.product_velocity_metrics(updated_at);

------------------------------------------------------------
-- 11) PRICING_CAMPAIGNS
------------------------------------------------------------
CREATE TABLE public.pricing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  action_type text NOT NULL,
  discount_percent numeric,
  fixed_price numeric,
  rounding_mode text NOT NULL DEFAULT 'whole',
  overwrite_existing boolean NOT NULL DEFAULT false,
  workflow_status text DEFAULT 'Draft',
  approved_by text,
  approved_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  started_at timestamptz,
  ended_at timestamptz,
  pre_campaign_inventory integer,
  post_campaign_inventory integer,
  inventory_reduction integer,
  sell_through_delta numeric,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.pricing_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.pricing_campaigns FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_pricing_campaigns_workflow_status ON public.pricing_campaigns(workflow_status);
CREATE INDEX idx_pricing_campaigns_started_at ON public.pricing_campaigns(started_at);
CREATE INDEX idx_pricing_campaigns_ended_at ON public.pricing_campaigns(ended_at);

------------------------------------------------------------
-- 12) PRICING_CAMPAIGN_ITEMS
------------------------------------------------------------
CREATE TABLE public.pricing_campaign_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.pricing_campaigns(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.variants(id) ON DELETE CASCADE,
  old_price numeric(12,2) NOT NULL,
  old_compare_at_price numeric(12,2),
  new_price numeric(12,2) NOT NULL,
  new_compare_at_price numeric(12,2),
  action_status text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.pricing_campaign_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.pricing_campaign_items FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_pci_campaign_id ON public.pricing_campaign_items(campaign_id);
CREATE INDEX idx_pci_variant_id ON public.pricing_campaign_items(variant_id);

------------------------------------------------------------
-- 13) ORDERS
------------------------------------------------------------
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text UNIQUE NOT NULL,
  status text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.orders FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_orders_status ON public.orders(status);
CREATE INDEX idx_orders_created_at ON public.orders(created_at);

------------------------------------------------------------
-- 14) ORDER_ITEMS
------------------------------------------------------------
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.variants(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.order_items FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX idx_order_items_product_id ON public.order_items(product_id);
CREATE INDEX idx_order_items_variant_id ON public.order_items(variant_id);

------------------------------------------------------------
-- 15) INVENTORY_BATCHES
------------------------------------------------------------
CREATE TABLE public.inventory_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES public.variants(id) ON DELETE CASCADE,
  batch_code text,
  quantity integer NOT NULL CHECK (quantity >= 0),
  expiry_date date,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.inventory_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.inventory_batches FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_inventory_batches_variant_id ON public.inventory_batches(variant_id);
CREATE INDEX idx_inventory_batches_expiry_date ON public.inventory_batches(expiry_date);

------------------------------------------------------------
-- 16) SIMULATION_LOGS
------------------------------------------------------------
CREATE TABLE public.simulation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_name text,
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.simulation_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.simulation_logs FOR ALL USING (true) WITH CHECK (true);

------------------------------------------------------------
-- 17) AI_RECOMMENDATIONS
------------------------------------------------------------
CREATE TABLE public.ai_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.variants(id) ON DELETE CASCADE,
  recommendation_type text NOT NULL,
  suggested_discount_percent numeric,
  suggested_new_price numeric(12,2),
  reason text NOT NULL,
  source_logic text NOT NULL,
  status text DEFAULT 'Draft',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.ai_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.ai_recommendations FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_ai_rec_product_id ON public.ai_recommendations(product_id);
CREATE INDEX idx_ai_rec_variant_id ON public.ai_recommendations(variant_id);
CREATE INDEX idx_ai_rec_status ON public.ai_recommendations(status);
CREATE INDEX idx_ai_rec_source_logic ON public.ai_recommendations(source_logic);
CREATE INDEX idx_ai_rec_created_at ON public.ai_recommendations(created_at DESC);

------------------------------------------------------------
-- UPDATED_AT TRIGGER FUNCTION
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_variants_updated_at BEFORE UPDATE ON public.variants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_pvm_updated_at BEFORE UPDATE ON public.product_velocity_metrics FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
