-- Shopify's OWN first-party session/bounce-rate analytics (ShopifyQL
-- `FROM sessions`), synced daily per store. Added as the KPI Tracker's
-- bounce-rate source after GA4's numbers were found corrupted by a broken
-- Web Pixel sandbox tag (near-100% bounce site-wide from 2026-08-25 on,
-- traced to phantom sessions from a /web-pixels@.../sandbox/ "landing page").
-- Shopify's native session tracking is unaffected by that GA4-side tag issue.

CREATE TABLE public.shopify_sessions_daily (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  date             date NOT NULL,
  sessions         integer NOT NULL DEFAULT 0,
  bounces          integer NOT NULL DEFAULT 0,
  bounce_rate      numeric NOT NULL DEFAULT 0, -- fraction 0-1
  conversion_rate  numeric NOT NULL DEFAULT 0, -- fraction 0-1
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, date)
);

ALTER TABLE public.shopify_sessions_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read shopify_sessions_daily"
  ON public.shopify_sessions_daily FOR SELECT
  USING (auth.role() = 'authenticated');
