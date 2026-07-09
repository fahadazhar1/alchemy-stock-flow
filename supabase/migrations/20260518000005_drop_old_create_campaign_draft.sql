-- Drop the old overload of create_campaign_draft that lacks p_variant_ids
-- and has a different parameter order. PostgreSQL couldn't resolve which to call,
-- causing "Could not choose best candidate function" on the manual sync page.
-- The canonical version (with p_variant_ids) was established in migration 20260403230151.

DROP FUNCTION IF EXISTS public.create_campaign_draft(
  text,      -- p_campaign_name
  numeric,   -- p_discount_percent
  numeric,   -- p_fixed_price
  boolean,   -- p_overwrite_existing
  uuid[],    -- p_product_ids
  text,      -- p_rounding_mode
  text,      -- p_source
  uuid       -- p_store_id
);
