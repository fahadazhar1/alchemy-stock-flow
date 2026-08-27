-- Drop the old 6-param overload of apply_bulk_discount (without p_store_id).
-- The 7-param canonical version was established in migration 20260518000006.
-- Having both caused PostgREST to call the old one, storing campaigns without
-- store_id and breaking push_prices ("Campaign or store not found").

DROP FUNCTION IF EXISTS public.apply_bulk_discount(
  uuid[],    -- p_product_ids
  numeric,   -- p_discount_percent
  numeric,   -- p_fixed_price
  text,      -- p_campaign_name
  boolean,   -- p_overwrite_existing
  text       -- p_rounding_mode
);
