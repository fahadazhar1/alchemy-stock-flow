-- GA4 daily metrics, synced once a day by the ga4-sync edge function (GA4's
-- own reporting API is already a daily aggregate, unlike Shopify's live
-- orders feed — no need for the resumable/paginated sync pattern used there).
--
-- GA4's `date` dimension is already a calendar date in each property's own
-- configured reporting timezone, so — unlike every orders-table RPC on this
-- page — no KSA UTC-shift is needed here. A plain date range lines up
-- correctly per property already.
--
-- Writes only happen via the edge function's service-role client; no
-- INSERT/UPDATE policy is granted to authenticated/anon.

CREATE TABLE public.ga4_daily_metrics (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  date         date NOT NULL,
  sessions     integer NOT NULL DEFAULT 0,
  bounce_rate  numeric NOT NULL DEFAULT 0, -- fraction 0-1, as GA4 returns it
  conversions  integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, date)
);

ALTER TABLE public.ga4_daily_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read ga4_daily_metrics"
  ON public.ga4_daily_metrics FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE TABLE public.ga4_channel_daily (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  date          date NOT NULL,
  channel_group text NOT NULL, -- GA4's sessionDefaultChannelGroup, e.g. "Organic Search", "Direct"
  sessions      integer NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, date, channel_group)
);

ALTER TABLE public.ga4_channel_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read ga4_channel_daily"
  ON public.ga4_channel_daily FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE OR REPLACE FUNCTION public.get_ga4_monthly_summary(p_start_date date, p_end_date date)
RETURNS TABLE (store_id uuid, sessions bigint, avg_bounce_rate numeric, conversions bigint, has_synced boolean)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    s.id,
    COALESCE(SUM(m.sessions), 0)::bigint,
    COALESCE(AVG(m.bounce_rate), 0),
    COALESCE(SUM(m.conversions), 0)::bigint,
    EXISTS (SELECT 1 FROM public.ga4_daily_metrics WHERE store_id = s.id)
  FROM public.stores s
  LEFT JOIN public.ga4_daily_metrics m
    ON m.store_id = s.id AND m.date >= p_start_date AND m.date <= p_end_date
  WHERE s.is_active
  GROUP BY s.id
$$;

GRANT EXECUTE ON FUNCTION public.get_ga4_monthly_summary(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_ga4_channel_summary(p_start_date date, p_end_date date)
RETURNS TABLE (store_id uuid, channel_group text, sessions bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT store_id, channel_group, COALESCE(SUM(sessions), 0)::bigint
  FROM public.ga4_channel_daily
  WHERE date >= p_start_date AND date <= p_end_date
  GROUP BY store_id, channel_group
$$;

GRANT EXECUTE ON FUNCTION public.get_ga4_channel_summary(date, date) TO authenticated;
