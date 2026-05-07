
------------------------------------------------------------
-- VIEW: v_product_inventory_summary
------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_product_inventory_summary AS
SELECT
  p.id AS product_id,
  p.name AS product_name,
  p.sku,
  v_agg.vendor_name,
  c.name AS collection_name,
  p.product_type,
  COALESCE(v_agg.total_inventory, 0) AS total_inventory,
  v_agg.min_current_price,
  v_agg.max_compare_at_price,
  v_agg.campaign_name,
  (CURRENT_DATE - p.created_at::date) AS days_old,
  CASE WHEN v_agg.has_discount THEN 'discounted' ELSE 'active' END AS discount_status,
  v_agg.nearest_expiry_date,
  CASE
    WHEN v_agg.nearest_expiry_date IS NULL THEN 'No Expiry'
    WHEN v_agg.nearest_expiry_date < CURRENT_DATE THEN 'Expired'
    WHEN v_agg.nearest_expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'Expiring Soon'
    ELSE 'Healthy Shelf Life'
  END AS near_expiry_status,
  p.status AS product_status,
  p.created_at
FROM public.products p
LEFT JOIN public.collections c ON c.id = p.collection_id
LEFT JOIN LATERAL (
  SELECT
    SUM(va.inventory_quantity) AS total_inventory,
    MIN(va.price) AS min_current_price,
    MAX(va.compare_at_price) AS max_compare_at_price,
    MAX(va.campaign_name) AS campaign_name,
    MIN(va.expiry_date) AS nearest_expiry_date,
    bool_or(va.compare_at_price IS NOT NULL AND va.compare_at_price > 0) AS has_discount,
    vn.name AS vendor_name
  FROM public.variants va
  LEFT JOIN public.vendors vn ON vn.id = p.vendor_id
  WHERE va.product_id = p.id
  GROUP BY vn.name
) v_agg ON true;

------------------------------------------------------------
-- VIEW: v_dashboard_kpis
------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_dashboard_kpis AS
WITH variant_stats AS (
  SELECT
    SUM(inventory_quantity) AS on_hand_inventory,
    SUM(inventory_quantity - committed_quantity) AS available_units
  FROM public.variants
),
pending_orders AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS pending_order_inventory
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.status IN ('pending', 'unfulfilled')
),
current_month_sales AS (
  SELECT COALESCE(SUM(oi.quantity), 0) AS fulfilled_units
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.status = 'fulfilled'
    AND date_trunc('month', o.created_at) = date_trunc('month', now())
),
oos AS (
  SELECT COUNT(*) AS out_of_stock_products
  FROM public.products p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.variants v WHERE v.product_id = p.id AND v.inventory_quantity > 0
  )
),
loser_calc AS (
  SELECT COUNT(*) AS losers_count
  FROM public.products p
  WHERE (CURRENT_DATE - p.created_at::date) > 20
    AND COALESCE((SELECT SUM(v.inventory_quantity) FROM public.variants v WHERE v.product_id = p.id), 0) > 10
),
winner_calc AS (
  SELECT COUNT(*) AS winners_count
  FROM public.products p
  WHERE NOT (
    (CURRENT_DATE - p.created_at::date) > 20
    AND COALESCE((SELECT SUM(v.inventory_quantity) FROM public.variants v WHERE v.product_id = p.id), 0) > 10
  )
),
near_expiry AS (
  SELECT COUNT(DISTINCT v.product_id) AS near_expiry_products_count
  FROM public.variants v
  WHERE v.expiry_date IS NOT NULL
    AND v.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
    AND v.expiry_date >= CURRENT_DATE
),
low_stock_winners AS (
  SELECT COUNT(*) AS low_stock_winners_count
  FROM public.products p
  WHERE NOT (
    (CURRENT_DATE - p.created_at::date) > 20
    AND COALESCE((SELECT SUM(v.inventory_quantity) FROM public.variants v WHERE v.product_id = p.id), 0) > 10
  )
  AND COALESCE((SELECT SUM(v.inventory_quantity - v.committed_quantity) FROM public.variants v WHERE v.product_id = p.id), 0) < 10
  AND COALESCE((SELECT SUM(v.inventory_quantity - v.committed_quantity) FROM public.variants v WHERE v.product_id = p.id), 0) > 0
),
campaigns_running AS (
  SELECT COUNT(*) AS campaigns_running_count
  FROM public.pricing_campaigns
  WHERE workflow_status IN ('Approved', 'Executed')
    AND (ended_at IS NULL OR ended_at > now())
),
pending_approvals AS (
  SELECT COUNT(*) AS pending_approvals_count
  FROM public.pricing_campaigns
  WHERE workflow_status = 'Pending Approval'
)
SELECT
  vs.on_hand_inventory,
  vs.available_units,
  po.pending_order_inventory,
  CASE
    WHEN (vs.on_hand_inventory + cms.fulfilled_units) > 0
    THEN ROUND((cms.fulfilled_units::numeric / (vs.on_hand_inventory + cms.fulfilled_units)::numeric) * 100, 1)
    ELSE 0
  END AS sell_through_ratio_current_month,
  oos.out_of_stock_products,
  (SELECT COUNT(*) FROM public.collections) AS collections_count,
  (SELECT COUNT(*) FROM public.vendors) AS vendors_count,
  lc.losers_count,
  wc.winners_count,
  ne.near_expiry_products_count,
  lsw.low_stock_winners_count,
  cr.campaigns_running_count,
  pa.pending_approvals_count
FROM variant_stats vs, pending_orders po, current_month_sales cms, oos, loser_calc lc, winner_calc wc, near_expiry ne, low_stock_winners lsw, campaigns_running cr, pending_approvals pa;

------------------------------------------------------------
-- VIEW: v_loser_products
------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_loser_products AS
SELECT
  p.id AS product_id,
  p.name AS product_name,
  p.sku,
  COALESCE(SUM(v.inventory_quantity), 0) AS total_inventory,
  (CURRENT_DATE - p.created_at::date) AS days_old,
  vn.name AS vendor_name,
  c.name AS collection_name
FROM public.products p
LEFT JOIN public.variants v ON v.product_id = p.id
LEFT JOIN public.vendors vn ON vn.id = p.vendor_id
LEFT JOIN public.collections c ON c.id = p.collection_id
GROUP BY p.id, p.name, p.sku, p.created_at, vn.name, c.name
HAVING (CURRENT_DATE - p.created_at::date) > 20
   AND COALESCE(SUM(v.inventory_quantity), 0) > 10;

------------------------------------------------------------
-- VIEW: v_campaign_performance
------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_campaign_performance AS
SELECT
  pc.id AS campaign_id,
  pc.name AS campaign_name,
  pc.started_at,
  pc.ended_at,
  pc.workflow_status,
  COUNT(DISTINCT pci.variant_id) AS variants_affected,
  COUNT(DISTINCT v.product_id) AS products_affected,
  ROUND(AVG(
    CASE WHEN pci.old_compare_at_price IS NOT NULL AND pci.old_compare_at_price > 0
      THEN ((pci.old_compare_at_price - pci.new_price) / pci.old_compare_at_price * 100)
      WHEN pci.old_price > 0
      THEN ((pci.old_price - pci.new_price) / pci.old_price * 100)
      ELSE 0
    END
  ), 1) AS average_discount_percent,
  pc.pre_campaign_inventory,
  pc.post_campaign_inventory,
  pc.inventory_reduction,
  pc.sell_through_delta
FROM public.pricing_campaigns pc
LEFT JOIN public.pricing_campaign_items pci ON pci.campaign_id = pc.id
LEFT JOIN public.variants v ON v.id = pci.variant_id
GROUP BY pc.id;

------------------------------------------------------------
-- VIEW: v_replenishment_candidates
------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_replenishment_candidates AS
SELECT
  p.id AS product_id,
  p.name AS product_name,
  p.sku,
  COALESCE(SUM(v.inventory_quantity - v.committed_quantity), 0) AS available_units,
  COALESCE(pvm.units_sold_7d, 0) AS velocity,
  CASE
    WHEN COALESCE(SUM(v.inventory_quantity - v.committed_quantity), 0) = 0 THEN 'Out of Stock'
    WHEN COALESCE(SUM(v.inventory_quantity - v.committed_quantity), 0) < 5 THEN 'Replenish Now'
    WHEN COALESCE(SUM(v.inventory_quantity - v.committed_quantity), 0) < 15 THEN 'Low Stock Winner'
    ELSE 'Watch Closely'
  END AS replenishment_status
FROM public.products p
LEFT JOIN public.variants v ON v.product_id = p.id
LEFT JOIN public.product_velocity_metrics pvm ON pvm.product_id = p.id
WHERE NOT (
  (CURRENT_DATE - p.created_at::date) > 20
  AND COALESCE((SELECT SUM(v2.inventory_quantity) FROM public.variants v2 WHERE v2.product_id = p.id), 0) > 10
)
GROUP BY p.id, p.name, p.sku, pvm.units_sold_7d
HAVING COALESCE(SUM(v.inventory_quantity - v.committed_quantity), 0) < 20;

------------------------------------------------------------
-- RPC: apply_bulk_discount
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
  v_margin_floor numeric;
  v_pre_inventory integer;
BEGIN
  -- Get margin floor from settings
  SELECT COALESCE((setting_value->>'margin_floor_percent')::numeric, 0)
  INTO v_margin_floor
  FROM public.app_settings WHERE setting_key = 'pricing_config';

  v_total_products := array_length(p_product_ids, 1);

  -- Get pre-campaign inventory
  SELECT COALESCE(SUM(inventory_quantity), 0) INTO v_pre_inventory
  FROM public.variants WHERE product_id = ANY(p_product_ids);

  -- Create campaign record
  INSERT INTO public.pricing_campaigns (name, action_type, discount_percent, fixed_price, rounding_mode, overwrite_existing, workflow_status, started_at, pre_campaign_inventory)
  VALUES (p_campaign_name, 'bulk_discount', p_discount_percent, p_fixed_price, p_rounding_mode, p_overwrite_existing, 'Executed', now(), v_pre_inventory)
  RETURNING id INTO v_campaign_id;

  FOR v_variant IN
    SELECT v.id, v.price, v.compare_at_price, v.product_id, v.variant_sku
    FROM public.variants v
    WHERE v.product_id = ANY(p_product_ids)
  LOOP
    -- Check if already discounted
    IF v_variant.compare_at_price IS NOT NULL AND v_variant.compare_at_price > 0 THEN
      v_already_discounted := v_already_discounted + 1;
      IF NOT p_overwrite_existing THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      ELSE
        v_overwritten := v_overwritten + 1;
      END IF;
    END IF;

    -- Calculate new price
    IF p_fixed_price IS NOT NULL THEN
      v_new_price := p_fixed_price;
    ELSIF p_discount_percent IS NOT NULL THEN
      v_new_price := v_variant.price * (1 - p_discount_percent / 100.0);
    ELSE
      CONTINUE;
    END IF;

    -- Apply rounding
    IF p_rounding_mode = 'whole' THEN
      v_new_price := ROUND(v_new_price);
    ELSIF p_rounding_mode = '.00' THEN
      v_new_price := ROUND(v_new_price)::numeric(12,2);
    ELSIF p_rounding_mode = '.99' THEN
      v_new_price := FLOOR(v_new_price) + 0.99;
    END IF;

    -- Ensure non-negative
    IF v_new_price < 0 THEN v_new_price := 0; END IF;

    -- Create campaign item
    INSERT INTO public.pricing_campaign_items (campaign_id, variant_id, old_price, old_compare_at_price, new_price, new_compare_at_price, action_status)
    VALUES (v_campaign_id, v_variant.id, v_variant.price, v_variant.compare_at_price, v_new_price,
      CASE WHEN v_variant.compare_at_price IS NOT NULL AND v_variant.compare_at_price > 0
        THEN v_variant.compare_at_price ELSE v_variant.price END,
      'applied');

    -- Update variant
    UPDATE public.variants
    SET price = v_new_price,
        compare_at_price = CASE WHEN compare_at_price IS NOT NULL AND compare_at_price > 0 THEN compare_at_price ELSE price END,
        campaign_name = p_campaign_name,
        last_discounted_at = now()
    WHERE id = v_variant.id;

    v_success := v_success + 1;
    v_eligible := v_eligible + 1;
  END LOOP;

  -- Log the sync
  INSERT INTO public.inventory_sync_logs (action_type, campaign_name, items_affected, status, metadata)
  VALUES ('bulk_discount', p_campaign_name, v_success, 'Success',
    jsonb_build_object('campaign_id', v_campaign_id, 'total_products', v_total_products, 'variants_affected', v_success, 'skipped', v_skipped, 'overwritten', v_overwritten));

  RETURN jsonb_build_object(
    'status', 'success',
    'campaign_id', v_campaign_id,
    'total_products_selected', v_total_products,
    'eligible_products_count', v_eligible,
    'total_variants_affected', v_success,
    'already_discounted_products_count', v_already_discounted,
    'skipped_variants_count', v_skipped,
    'overwritten_variants_count', v_overwritten,
    'success_count', v_success
  );
END;
$$;

------------------------------------------------------------
-- RPC: preview_bulk_discount
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

    IF p_fixed_price IS NOT NULL THEN
      v_new_price := p_fixed_price;
    ELSIF p_discount_percent IS NOT NULL THEN
      v_new_price := v_variant.price * (1 - p_discount_percent / 100.0);
    ELSE
      CONTINUE;
    END IF;

    IF p_rounding_mode = 'whole' THEN v_new_price := ROUND(v_new_price);
    ELSIF p_rounding_mode = '.00' THEN v_new_price := ROUND(v_new_price)::numeric(12,2);
    ELSIF p_rounding_mode = '.99' THEN v_new_price := FLOOR(v_new_price) + 0.99;
    END IF;
    IF v_new_price < 0 THEN v_new_price := 0; END IF;

    v_eligible := v_eligible + 1;

    IF v_eligible <= 3 THEN
      v_result := v_result || jsonb_build_object(
        'product_name', v_variant.product_name,
        'variant_sku', v_variant.variant_sku,
        'current_price', v_variant.price,
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
-- RPC: revert_variant_pricing
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revert_variant_pricing(
  p_variant_id uuid DEFAULT NULL,
  p_product_id uuid DEFAULT NULL,
  p_product_ids uuid[] DEFAULT NULL,
  p_campaign_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affected integer := 0;
BEGIN
  UPDATE public.variants
  SET 
    price = CASE 
      WHEN compare_at_price IS NOT NULL AND compare_at_price > 0 THEN compare_at_price 
      ELSE price 
    END,
    compare_at_price = NULL,
    campaign_name = NULL,
    last_discounted_at = NULL
  WHERE 
    (p_variant_id IS NOT NULL AND id = p_variant_id)
    OR (p_product_id IS NOT NULL AND product_id = p_product_id)
    OR (p_product_ids IS NOT NULL AND product_id = ANY(p_product_ids))
    OR (p_campaign_id IS NOT NULL AND id IN (
      SELECT variant_id FROM public.pricing_campaign_items WHERE campaign_id = p_campaign_id
    ));

  GET DIAGNOSTICS v_affected = ROW_COUNT;

  INSERT INTO public.inventory_sync_logs (action_type, items_affected, status, metadata)
  VALUES ('revert', v_affected, 'Success',
    jsonb_build_object(
      'variant_id', p_variant_id, 
      'product_id', p_product_id, 
      'product_ids', p_product_ids, 
      'campaign_id', p_campaign_id, 
      'affected_count', v_affected
    ));

  RETURN jsonb_build_object('affected_count', v_affected, 'status', 'success');
END;
$$;

------------------------------------------------------------
-- RPC: create_campaign_draft
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
  v_items_count integer := 0;
  v_pre_inventory integer;
BEGIN
  -- Get pre-campaign inventory
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

    IF p_fixed_price IS NOT NULL THEN v_new_price := p_fixed_price;
    ELSIF p_discount_percent IS NOT NULL THEN v_new_price := v_variant.price * (1 - p_discount_percent / 100.0);
    ELSE CONTINUE;
    END IF;

    IF p_rounding_mode = 'whole' THEN v_new_price := ROUND(v_new_price);
    ELSIF p_rounding_mode = '.00' THEN v_new_price := ROUND(v_new_price)::numeric(12,2);
    ELSIF p_rounding_mode = '.99' THEN v_new_price := FLOOR(v_new_price) + 0.99;
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

------------------------------------------------------------
-- RPC: approve_and_execute_campaign
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_and_execute_campaign(
  p_campaign_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign RECORD;
  v_item RECORD;
  v_success integer := 0;
  v_post_inventory integer;
BEGIN
  SELECT * INTO v_campaign FROM public.pricing_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'error', 'message', 'Campaign not found'); END IF;
  IF v_campaign.workflow_status NOT IN ('Pending Approval', 'Approved') THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'Campaign is not in approvable state');
  END IF;

  -- Execute each item
  FOR v_item IN SELECT * FROM public.pricing_campaign_items WHERE campaign_id = p_campaign_id AND action_status = 'pending'
  LOOP
    UPDATE public.variants
    SET price = v_item.new_price,
        compare_at_price = v_item.new_compare_at_price,
        campaign_name = v_campaign.name,
        last_discounted_at = now()
    WHERE id = v_item.variant_id;

    UPDATE public.pricing_campaign_items SET action_status = 'applied' WHERE id = v_item.id;
    v_success := v_success + 1;
  END LOOP;

  -- Get post inventory
  SELECT COALESCE(SUM(v.inventory_quantity), 0) INTO v_post_inventory
  FROM public.variants v
  JOIN public.pricing_campaign_items pci ON pci.variant_id = v.id
  WHERE pci.campaign_id = p_campaign_id;

  UPDATE public.pricing_campaigns
  SET workflow_status = 'Executed', approved_at = now(), started_at = COALESCE(started_at, now()), post_campaign_inventory = v_post_inventory,
      inventory_reduction = COALESCE(pre_campaign_inventory, 0) - v_post_inventory
  WHERE id = p_campaign_id;

  INSERT INTO public.inventory_sync_logs (action_type, campaign_name, items_affected, status, metadata)
  VALUES ('campaign_execute', v_campaign.name, v_success, 'Success', jsonb_build_object('campaign_id', p_campaign_id));

  RETURN jsonb_build_object('status', 'success', 'variants_executed', v_success, 'campaign_id', p_campaign_id);
END;
$$;

------------------------------------------------------------
-- RPC: preview_what_if_simulation
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_what_if_simulation(
  p_product_ids uuid[],
  p_discount_tiers numeric[],
  p_rounding_mode text DEFAULT 'whole'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier numeric;
  v_results jsonb := '[]'::jsonb;
  v_total_inventory integer;
  v_total_revenue numeric;
  v_scenario jsonb;
BEGIN
  SELECT COALESCE(SUM(inventory_quantity), 0), COALESCE(SUM(price * inventory_quantity), 0)
  INTO v_total_inventory, v_total_revenue
  FROM public.variants WHERE product_id = ANY(p_product_ids);

  FOREACH v_tier IN ARRAY p_discount_tiers
  LOOP
    v_scenario := jsonb_build_object(
      'discount_percent', v_tier,
      'projected_revenue', ROUND(v_total_revenue * (1 - v_tier / 100.0), 2),
      'revenue_impact', ROUND(v_total_revenue * (v_tier / 100.0), 2),
      'projected_sell_through_improvement', ROUND(v_tier * 0.8, 1),
      'projected_inventory_reduction', ROUND(v_total_inventory * (v_tier / 100.0 * 0.5)),
      'margin_pressure', ROUND(v_tier * 0.9, 1)
    );
    v_results := v_results || v_scenario;
  END LOOP;

  RETURN jsonb_build_object('scenarios', v_results, 'base_inventory', v_total_inventory, 'base_revenue', v_total_revenue);
END;
$$;
