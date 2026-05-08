-- Monthly opening-stock snapshots for sell-through calculation
CREATE TABLE IF NOT EXISTS public.inventory_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  total_units   integer NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (store_id, snapshot_date)
);

ALTER TABLE public.inventory_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.inventory_snapshots FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_inv_snapshots_store_date ON public.inventory_snapshots(store_id, snapshot_date);

-- Function: snapshot inventory per store (runs on 1st of each month)
CREATE OR REPLACE FUNCTION public.snapshot_monthly_inventory()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.inventory_snapshots (store_id, snapshot_date, total_units)
  SELECT
    v.store_id,
    date_trunc('month', CURRENT_DATE)::date,
    SUM(v.inventory_quantity)
  FROM public.variants v
  WHERE v.store_id IS NOT NULL
  GROUP BY v.store_id
  ON CONFLICT (store_id, snapshot_date)
  DO UPDATE SET total_units = EXCLUDED.total_units;
END;
$$;

-- Schedule: midnight on the 1st of every month
SELECT cron.schedule(
  'monthly-inventory-snapshot',
  '0 0 1 * *',
  $$ SELECT public.snapshot_monthly_inventory(); $$
);

-- Seed the current month immediately so sell-through works today
SELECT public.snapshot_monthly_inventory();
