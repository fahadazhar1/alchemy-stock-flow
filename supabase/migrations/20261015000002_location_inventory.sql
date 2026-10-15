-- Per-location stock + order fulfilment location.
-- Reuses the existing (empty, unused) central-WMS inventory_levels table instead of a new one:
-- rows now also key on (variant_id, shopify_location_id). The old master_variant_id path keeps
-- working (column made nullable; v_central_inventory joins from master_variants so new rows don't leak in).
-- variants.inventory_quantity stays the all-locations total, so every existing view/RPC is unchanged.

ALTER TABLE public.inventory_levels
  ALTER COLUMN master_variant_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.variants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS shopify_inventory_item_id text,
  ADD COLUMN IF NOT EXISTS shopify_location_id text,
  ADD COLUMN IF NOT EXISTS location_name text;

DO $$ BEGIN
  ALTER TABLE public.inventory_levels
    ADD CONSTRAINT inventory_levels_variant_location_key UNIQUE (variant_id, shopify_location_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_inventory_levels_store_location ON public.inventory_levels (store_id, shopify_location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_levels_item ON public.inventory_levels (shopify_inventory_item_id);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fulfillment_location_id text,
  ADD COLUMN IF NOT EXISTS fulfillment_location_name text;
CREATE INDEX IF NOT EXISTS idx_orders_store_fulfillment_location ON public.orders (store_id, fulfillment_location_id);

-- Locations that currently hold any stock row for a store (filter dropdown).
CREATE OR REPLACE FUNCTION public.get_store_locations(p_store_id uuid DEFAULT NULL)
RETURNS TABLE (store_id uuid, shopify_location_id text, location_name text, variants_count bigint, available_units bigint)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT il.store_id, il.shopify_location_id, max(il.location_name), count(*), sum(greatest(il.available_quantity, 0))
  FROM public.inventory_levels il
  WHERE il.variant_id IS NOT NULL AND (p_store_id IS NULL OR il.store_id = p_store_id)
  GROUP BY il.store_id, il.shopify_location_id
  ORDER BY 3;
$$;

-- Per-product, per-location available stock for the products on the current page.
CREATE OR REPLACE FUNCTION public.get_product_location_stock(p_product_ids uuid[])
RETURNS TABLE (product_id uuid, shopify_location_id text, location_name text, available bigint)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT v.product_id, il.shopify_location_id, max(il.location_name), sum(il.available_quantity)
  FROM public.inventory_levels il
  JOIN public.variants v ON v.id = il.variant_id
  WHERE v.product_id = ANY (p_product_ids)
  GROUP BY v.product_id, il.shopify_location_id
  ORDER BY 1, 3;
$$;

-- Product ids with stock (> 0) at one location — used like get_collection_product_ids for filtering.
CREATE OR REPLACE FUNCTION public.get_location_product_ids(p_store_id uuid, p_location_id text)
RETURNS TABLE (product_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT DISTINCT v.product_id
  FROM public.inventory_levels il
  JOIN public.variants v ON v.id = il.variant_id
  WHERE il.shopify_location_id = p_location_id
    AND (p_store_id IS NULL OR il.store_id = p_store_id)
    AND il.available_quantity > 0;
$$;

GRANT EXECUTE ON FUNCTION public.get_store_locations(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_product_location_stock(uuid[]) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_location_product_ids(uuid, text) TO authenticated, anon;
