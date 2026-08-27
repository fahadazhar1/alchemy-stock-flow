-- P&L feature: manual cost tracking (ad spend, Shopify plan/apps, marketplace fees)
-- to sit alongside live Shopify revenue. Revenue itself is NOT duplicated here — the
-- P&L frontend reuses the existing get_store_period_channel_sales RPC for that side
-- (already egress-safe, already the source of truth for Sales Pulse). This migration
-- only adds what doesn't exist yet: a place to record monthly costs, and a small table
-- of FX rates so "All Stores" can show one blended total in SAR.
--
-- cost_entries is expected to stay tiny (a handful of rows per store per month), so a
-- direct .select() from the frontend is fine — it's not in the egress-rule's list of
-- large tables (orders, order_items, v_* views) that require RPC aggregation.

CREATE TABLE IF NOT EXISTS public.cost_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  category     text NOT NULL CHECK (category IN ('ad_spend', 'shopify_plan', 'shopify_apps', 'marketplace_fee', 'other')),
  platform     text CHECK (platform IN ('google', 'meta', 'tiktok', 'amazon', 'ebay', 'other')),
  month        date NOT NULL, -- always stored as first-of-month
  amount       numeric NOT NULL CHECK (amount >= 0),
  currency     text NOT NULL, -- snapshot of the store's currency at entry time
  notes        text,
  created_by   uuid REFERENCES auth.users(id),
  updated_by   uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cost_entries_store_month ON public.cost_entries (store_id, month);

ALTER TABLE public.cost_entries ENABLE ROW LEVEL SECURITY;

-- Anyone signed in can view the P&L (matches the rest of the dashboard being
-- viewable by any authenticated user, not just admins).
CREATE POLICY "authenticated_can_read_cost_entries" ON public.cost_entries
  FOR SELECT USING (auth.role() = 'authenticated');

-- Only admins can add/edit/delete cost entries.
CREATE POLICY "admin_can_write_cost_entries" ON public.cost_entries
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Monthly FX rates, only for currencies that actually float (GBP, PKR). SAR and AED
-- are fixed USD pegs (3.75 and 3.6725 respectively) and are handled as constants in
-- the frontend — no need to store or maintain rows for them here.
CREATE TABLE IF NOT EXISTS public.fx_rates (
  currency      text NOT NULL,
  month         date NOT NULL, -- first-of-month
  rate_to_sar   numeric NOT NULL CHECK (rate_to_sar > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (currency, month)
);

ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_can_read_fx_rates" ON public.fx_rates
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "admin_can_write_fx_rates" ON public.fx_rates
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );
