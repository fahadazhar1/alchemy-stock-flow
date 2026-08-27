-- Fahad's Choice rounding: round to nearest £0.50
-- Formula: ROUND(price * 2) / 2.0
-- e.g. 8.4915 → 8.50, 12.7415 → 12.50, 21.2415 → 21.00

------------------------------------------------------------
-- apply_bulk_discount
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_bulk_discount(
  p_product_ids uuid[],
  p_discount_percent numeric DEFAULT NULL,
  p_fixed_price numeric DEFAULT NULL,
  p_campaign_name text DEFAULT 'Unnamed Campaign',
  p_overwrite_existing boolean DEFAULT false,
  p_rounding_mode text DEFAULT 'whole'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_id uuid;
  v_total_products integer;
  v_eligible integer := 0;
  v_already_discounted integer := 0;
  v_skipped integer := 0;
  v_overwritten integer := 0;
  v_success integer := 0;
  v_variant RECORD;
  v_new_price numeric(12,2);
  v_base_price numeric(12,2);
  v_margin_floor numeric;
  v_pre_inventory integer;
BEGIN
  SELECT COALESCE((setting_value->>'margin_floor_percent')::numeric, 0)
  INTO v_margin_floor
  FROM public.app_settings WHERE setting_key = 'pricing_config';

  v_total_products := array_length(p_product_ids, 1);

  SELECT COALESCE(SUM(inventory_quantity), 0) INTO v_pre_inventory
  FROM public.variants WHERE product_id = ANY(p_product_ids);

  INSERT INTO public.pricing_campaigns (name, action_type, discount_percent, fixed_price, rounding_mode, overwrite_existing, workflow_status, started_at, pre_campaign_inventory)
  VALUES (p_campaign_name, 'bulk_discount', p_discount_percent, p_fixed_price, p_rounding_mode, p_overwrite_existing, 'Executed', now(), v_pre_inventory)
  RETURNING id INTO v_campaign_id;

  FOR v_variant IN
    SELECT v.id, v.price, v.compare_at_price, v.product_id, v.variant_sku
    FROM public.variants v
    WHERE v.product_id = ANY(p_product_ids)
  LOOP
    IF v_variant.compare_at_price IS NOT NULL AND v_variant.compare_at_price > 0 THEN
      v_already_discounted := v_already_discounted + 1;
      IF NOT p_overwrite_existing THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      ELSE
        v_overwritten := v_overwritten + 1;
      END IF;
    END IF;

    v_base_price := CASE
      WHEN p_overwrite_existing AND v_variant.compare_at_price IS NOT NULL AND v_variant.compare_at_price > 0
      THEN v_variant.compare_at_price
      ELSE v_variant.price
    END;

    IF p_fixed_price IS NOT NULL THEN
      v_new_price := p_fixed_price;
    ELSIF p_discount_percent IS NOT NULL THEN
      v_new_price := v_base_price * (1 - p_discount_percent / 100.0);
    ELSE
      CONTINUE;
    END IF;

    IF p_rounding_mode = 'whole' THEN
      v_new_price := ROUND(v_new_price);
    ELSIF p_rounding_mode = '.00' THEN
      v_new_price := ROUND(v_new_price)::numeric(12,2);
    ELSIF p_rounding_mode = '.99' THEN
      v_new_price := FLOOR(v_new_price) + 0.99;
    ELSIF p_rounding_mode = 'fahads_choice' THEN
      v_new_price := ROUND(v_new_price * 2) / 2.0;
    END IF;

    IF v_new_price < 0 THEN v_new_price := 0; END IF;

    INSERT INTO public.pricing_campaign_items (campaign_id, variant_id, old_price, old_compare_at_price, new_price, new_compare_at_price, action_status)
    VALUES (v_campaign_id, v_variant.id, v_variant.price, v_variant.compare_at_price, v_new_price,
      CASE WHEN v_variant.compare_at_price IS NOT NULL AND v_variant.compare_at_price > 0
        THEN v_variant.compare_at_price ELSE v_variant.price END,
      'applied');

    UPDATE public.variants
    SET price = v_new_price,
        compare_at_price = CASE WHEN compare_at_price IS NOT NULL AND compare_at_price > 0 THEN compare_at_price ELSE price END,
        campaign_name = p_campaign_name,
        last_discounted_at = now()
    WHERE id = v_variant.id;

    v_success := v_success + 1;
    v_eligible := v_eligible + 1;
  END LOOP;

  INSERT INTO public.inventory_sync_logs (action_type, campaign_name, items_affected, status, metadata)
  VALUES ('bulk_discount', p_campaign_name, v_success, 'Success',
    jsonb_build_object('campaign_id', v_campaign_id, 'total_products', v_total_products,
      'variants_affected', v_success, 'skipped', v_skipped, 'overwritten', v_overwritten));

  RETURN jsonb_build_object(
    'status', 'success',
    'campaign_id', v_campaign_id,
    'total_products', v_total_products,
    'variants_affected', v_success,
    'skipped', v_skipped,
    'overwritten', v_overwritten
  );
END;
$$;

------------------------------------------------------------
-- preview_bulk_discount
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_bulk_discount(
  p_product_ids uuid[],
  p_discount_percent numeric DEFAULT NULL,
  p_fixed_price numeric DEFAULT NULL,
  p_overwrite_existing boolean DEFAULT false,
  p_rounding_mode text DEFAULT 'whole'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '[]'::jsonb;
  v_variant RECORD;
  v_new_price numeric(12,2);
  v_base_price numeric(12,2);
  v_count integer := 0;
  v_eligible integer := 0;
  v_skipped integer := 0;
  v_already_discounted integer := 0;
BEGIN
  FOR v_variant IN
    SELECT v.id, v.variant_sku, v.price, v.compare_at_price, v.product_id, p.name AS product_name
    FROM public.variants v
    JOIN public.products p ON p.id = v.product_id
    WHERE v.product_id = ANY(p_product_ids)
  LOOP
    v_count := v_count + 1;

    IF v_variant.compare_at_price IS NOT NULL AND v_variant.compare_at_price > 0 THEN
      v_already_discounted := v_already_discounted + 1;
      IF NOT p_overwrite_existing THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
    END IF;

    v_base_price := CASE
      WHEN p_overwrite_existing AND v_variant.compare_at_price IS NOT NULL AND v_variant.compare_at_price > 0
      THEN v_variant.compare_at_price
      ELSE v_variant.price
    END;

    IF p_fixed_price IS NOT NULL THEN
      v_new_price := p_fixed_price;
    ELSIF p_discount_percent IS NOT NULL THEN
      v_new_price := v_base_price * (1 - p_discount_percent / 100.0);
    ELSE
      CONTINUE;
    END IF;

    IF p_rounding_mode = 'whole' THEN
      v_new_price := ROUND(v_new_price);
    ELSIF p_rounding_mode = '.00' THEN
      v_new_price := ROUND(v_new_price)::numeric(12,2);
    ELSIF p_rounding_mode = '.99' THEN
      v_new_price := FLOOR(v_new_price) + 0.99;
    ELSIF p_rounding_mode = 'fahads_choice' THEN
      v_new_price := ROUND(v_new_price * 2) / 2.0;
    END IF;
    IF v_new_price < 0 THEN v_new_price := 0; END IF;

    v_eligible := v_eligible + 1;

    IF v_eligible <= 3 THEN
      v_result := v_result || jsonb_build_object(
        'product_name', v_variant.product_name,
        'variant_sku', v_variant.variant_sku,
        'current_price', v_base_price,
        'new_price', v_new_price,
        'already_discounted', (v_variant.compare_at_price IS NOT NULL AND v_variant.compare_at_price > 0),
        'will_be_skipped', false
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'total_variants', v_count,
    'eligible_variants', v_eligible,
    'already_discounted', v_already_discounted,
    'skipped_variants', v_skipped,
    'sample_preview', v_result
  );
END;
$$;

------------------------------------------------------------
-- create_campaign_draft
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_campaign_draft(
  p_product_ids uuid[] DEFAULT NULL,
  p_variant_ids uuid[] DEFAULT NULL,
  p_discount_percent numeric DEFAULT NULL,
  p_fixed_price numeric DEFAULT NULL,
  p_campaign_name text DEFAULT 'Draft Campaign',
  p_overwrite_existing boolean DEFAULT false,
  p_rounding_mode text DEFAULT 'whole',
  p_source text DEFAULT 'manual',
  p_store_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_id uuid;
  v_variant RECORD;
  v_new_price numeric(12,2);
  v_base_price numeric(12,2);
  v_items_count integer := 0;
  v_pre_inventory integer;
BEGIN
  SELECT COALESCE(SUM(inventory_quantity), 0) INTO v_pre_inventory
  FROM public.variants
  WHERE (p_product_ids IS NOT NULL AND product_id = ANY(p_product_ids))
     OR (p_variant_ids IS NOT NULL AND id = ANY(p_variant_ids));

  INSERT INTO public.pricing_campaigns (name, action_type, discount_percent, fixed_price, rounding_mode, overwrite_existing, workflow_status, pre_campaign_inventory, store_id)
  VALUES (p_campaign_name, p_source, p_discount_percent, p_fixed_price, p_rounding_mode, p_overwrite_existing, 'Pending Approval', v_pre_inventory, p_store_id)
  RETURNING id INTO v_campaign_id;

  FOR v_variant IN
    SELECT v.id, v.price, v.compare_at_price
    FROM public.variants v
    WHERE (p_product_ids IS NOT NULL AND v.product_id = ANY(p_product_ids))
       OR (p_variant_ids IS NOT NULL AND v.id = ANY(p_variant_ids))
  LOOP
    IF v_variant.compare_at_price IS NOT NULL AND v_variant.compare_at_price > 0 AND NOT p_overwrite_existing THEN
      CONTINUE;
    END IF;

    v_base_price := CASE
      WHEN p_overwrite_existing AND v_variant.compare_at_price IS NOT NULL AND v_variant.compare_at_price > 0
      THEN v_variant.compare_at_price
      ELSE v_variant.price
    END;

    IF p_fixed_price IS NOT NULL THEN v_new_price := p_fixed_price;
    ELSIF p_discount_percent IS NOT NULL THEN v_new_price := v_base_price * (1 - p_discount_percent / 100.0);
    ELSE CONTINUE;
    END IF;

    IF p_rounding_mode = 'whole' THEN
      v_new_price := ROUND(v_new_price);
    ELSIF p_rounding_mode = '.00' THEN
      v_new_price := ROUND(v_new_price)::numeric(12,2);
    ELSIF p_rounding_mode = '.99' THEN
      v_new_price := FLOOR(v_new_price) + 0.99;
    ELSIF p_rounding_mode = 'fahads_choice' THEN
      v_new_price := ROUND(v_new_price * 2) / 2.0;
    END IF;
    IF v_new_price < 0 THEN v_new_price := 0; END IF;

    INSERT INTO public.pricing_campaign_items (campaign_id, variant_id, old_price, old_compare_at_price, new_price, new_compare_at_price, action_status)
    VALUES (v_campaign_id, v_variant.id, v_variant.price, v_variant.compare_at_price, v_new_price,
      COALESCE(v_variant.compare_at_price, v_variant.price), 'pending');
    v_items_count := v_items_count + 1;
  END LOOP;

  RETURN jsonb_build_object('campaign_id', v_campaign_id, 'items_count', v_items_count, 'status', 'draft_created');
END;
$$;
