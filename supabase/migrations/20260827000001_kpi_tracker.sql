-- Daily KPI Tracker ("ClickUp Reports" page). Two tables:
--  - kpi_metric_config: one row per store x metric, mostly-static (label/owner/target),
--    edited rarely via the page's inline inputs.
--  - daily_kpi_entries: one row per store x metric x day for the metrics that have
--    no live data source (manual entry). Sales / Organic traffic / Bounce rate+CRO are
--    NOT stored here — they're computed live from existing orders/GA4 tables at read
--    time via the same RPCs the Sales Pulse and P&L pages already use, so there's
--    nothing to keep in sync.
--
-- Small operational tables (a few dozen / a few hundred rows), not the large
-- orders-scale tables the RPC-only egress rule targets — direct
-- select/insert/upsert from the frontend is fine here, matching the
-- cost_entries / user_page_layouts precedent.

CREATE TABLE public.kpi_metric_config (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  metric_key   text NOT NULL,
  metric_label text NOT NULL,
  owner        text NOT NULL DEFAULT '',
  target       text NOT NULL DEFAULT '',
  is_auto      boolean NOT NULL DEFAULT false,
  sort_order   integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, metric_key)
);

ALTER TABLE public.kpi_metric_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read kpi_metric_config"
  ON public.kpi_metric_config FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated can write kpi_metric_config"
  ON public.kpi_metric_config FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE TABLE public.daily_kpi_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  entry_date  date NOT NULL,
  metric_key  text NOT NULL,
  value_text  text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, entry_date, metric_key)
);

ALTER TABLE public.daily_kpi_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read daily_kpi_entries"
  ON public.daily_kpi_entries FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated can write daily_kpi_entries"
  ON public.daily_kpi_entries FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Seed the 9 metrics for all 4 active stores, in the order shown on the page.
INSERT INTO public.kpi_metric_config (store_id, metric_key, metric_label, is_auto, sort_order)
SELECT s.id, m.metric_key, m.metric_label, m.is_auto, m.sort_order
FROM public.stores s
CROSS JOIN (VALUES
  ('sales',            'Sales (today and MTD)',      true,  1),
  ('organic_traffic',  'Organic traffic',             true,  2),
  ('paid_traffic_roas','Paid traffic and ROAS',       false, 3),
  ('social_reach',     'Social reach and clicks',     false, 4),
  ('llm_referral',     'LLM referral traffic',        false, 5),
  ('bounce_cro',       'Bounce rate and CRO',          true,  6),
  ('video_output',     'Video output and impact',     false, 7),
  ('desc_updated',     'Product descriptions updated',false, 8),
  ('images_improved',  'Product images improved',     false, 9)
) AS m(metric_key, metric_label, is_auto, sort_order)
WHERE s.is_active
ON CONFLICT (store_id, metric_key) DO NOTHING;
