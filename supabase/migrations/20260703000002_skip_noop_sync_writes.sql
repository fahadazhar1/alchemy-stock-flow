-- ── Suppress redundant no-op writes from the sync (egress / WAL / bloat) ──────
-- The sync re-upserts every product's velocity row and every product↔collection
-- mapping on each run, even when nothing changed. Because each upsert writes a new
-- row version (and velocity sets updated_at = now()), this generated millions of
-- pointless writes (product_velocity_metrics: 13.9M updates for 4.5k rows;
-- product_collections: 12.9M updates for 25k rows) — WAL churn, table bloat, egress.
--
-- FIGURE-SAFETY: these BEFORE UPDATE triggers skip a write ONLY when the meaningful
-- data is identical. Any real change (a units_sold_* value moving, a new mapping)
-- still writes immediately. So stored figures are byte-identical to before; we only
-- drop writes that would have re-saved the exact same values.
--   • product_velocity_metrics: compares the sales columns + last_sale_at + store_id,
--     ignoring updated_at (which no view/function/client reads — verified). Named to
--     fire BEFORE update_pvm_updated_at so a skipped no-op doesn't even bump updated_at.
--   • product_collections: full-row identity check (the upsert only ever re-sends the
--     PK, so an existing mapping is a pure no-op).

-- 1) product_velocity_metrics --------------------------------------------------
CREATE OR REPLACE FUNCTION public.pvm_skip_noop_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.product_id     IS NOT DISTINCT FROM OLD.product_id
 AND NEW.store_id       IS NOT DISTINCT FROM OLD.store_id
 AND NEW.units_sold_7d  IS NOT DISTINCT FROM OLD.units_sold_7d
 AND NEW.units_sold_14d IS NOT DISTINCT FROM OLD.units_sold_14d
 AND NEW.units_sold_21d IS NOT DISTINCT FROM OLD.units_sold_21d
 AND NEW.units_sold_30d IS NOT DISTINCT FROM OLD.units_sold_30d
 AND NEW.last_sale_at   IS NOT DISTINCT FROM OLD.last_sale_at
  THEN
    RETURN NULL;  -- nothing meaningful changed → skip the write entirely
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS pvm_skip_noop_update ON public.product_velocity_metrics;
CREATE TRIGGER pvm_skip_noop_update
  BEFORE UPDATE ON public.product_velocity_metrics
  FOR EACH ROW EXECUTE FUNCTION public.pvm_skip_noop_update();

-- 2) product_collections -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.skip_identical_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NULL;  -- entire row unchanged → skip
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS pc_skip_noop_update ON public.product_collections;
CREATE TRIGGER pc_skip_noop_update
  BEFORE UPDATE ON public.product_collections
  FOR EACH ROW EXECUTE FUNCTION public.skip_identical_update();
