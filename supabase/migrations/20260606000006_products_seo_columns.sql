-- SEO fields synced from Shopify: meta_title + meta_description via GraphQL, image_alt_text via REST
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS meta_title       text,
  ADD COLUMN IF NOT EXISTS meta_description text,
  ADD COLUMN IF NOT EXISTS image_alt_text   text;
