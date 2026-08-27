-- Merge the "Shopify Plan" and "Shopify Apps" categories into one "Shopify"
-- category with a platform sub-type (plan/apps/other), matching the same
-- category+platform pattern already used by Ad Spend and Marketplace Fee.
-- Requested so Cost Breakdown by Category can show one expandable "Shopify"
-- row instead of two flat top-level rows, with room for future Shopify cost
-- types (e.g. Shopify Payments fees) without another schema change.
-- Also adds "shopify" as an Ad Spend platform (e.g. Shopify Audiences ads)
-- and "tiktok" as a Marketplace Fee platform (TikTok Shop selling fees,
-- distinct from "TikTok Ads" under Ad Spend).

-- 1. Widen both CHECKs first (adding 'shopify' alongside the old category
--    values still in use) so the data migration below is valid.
ALTER TABLE public.cost_entries DROP CONSTRAINT cost_entries_platform_check;
ALTER TABLE public.cost_entries ADD CONSTRAINT cost_entries_platform_check
  CHECK (platform IN ('google', 'meta', 'tiktok', 'shopify', 'amazon', 'ebay', 'plan', 'apps', 'other'));

ALTER TABLE public.cost_entries DROP CONSTRAINT cost_entries_category_check;
ALTER TABLE public.cost_entries ADD CONSTRAINT cost_entries_category_check
  CHECK (category IN ('ad_spend', 'shopify', 'shopify_plan', 'shopify_apps', 'marketplace_fee', 'other'));

-- 2. Migrate existing rows into the unified category.
UPDATE public.cost_entries SET category = 'shopify', platform = 'plan' WHERE category = 'shopify_plan';
UPDATE public.cost_entries SET category = 'shopify', platform = 'apps' WHERE category = 'shopify_apps';

-- 3. Narrow the category CHECK now that the old values are no longer in use.
ALTER TABLE public.cost_entries DROP CONSTRAINT cost_entries_category_check;
ALTER TABLE public.cost_entries ADD CONSTRAINT cost_entries_category_check
  CHECK (category IN ('ad_spend', 'shopify', 'marketplace_fee', 'other'));
