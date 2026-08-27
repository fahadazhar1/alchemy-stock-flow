-- Adds a raw `conversions` count (sessions_that_completed_checkout) alongside
-- the existing conversion_rate fraction. Needed so the KPI Tracker's "Bounce
-- rate and CRO" figure can be aggregated correctly across a multi-day filter
-- range (sum(bounces)/sum(sessions), sum(conversions)/sum(sessions)) instead
-- of averaging daily rates, and so it can actually follow the page's date
-- filter instead of being pinned to a single day.
ALTER TABLE public.shopify_sessions_daily
  ADD COLUMN conversions integer NOT NULL DEFAULT 0;
