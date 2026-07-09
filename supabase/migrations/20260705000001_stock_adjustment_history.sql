-------------------------------------------------------------
-- STOCK_ADJUSTMENT_HISTORY
-- Per-variant audit trail for manual stock adjustments made
-- from the Product Master "Adjust Stock" dialog.
-------------------------------------------------------------
CREATE TABLE public.stock_adjustment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid REFERENCES public.variants(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  store_id uuid,
  variant_sku text NOT NULL,
  product_name text,
  adjustment integer NOT NULL,
  quantity_before integer NOT NULL,
  quantity_after integer NOT NULL,
  location_name text,
  adjusted_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_adjustment_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for demo" ON public.stock_adjustment_history FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_stock_adjustment_history_variant_id ON public.stock_adjustment_history(variant_id);
CREATE INDEX idx_stock_adjustment_history_store_id ON public.stock_adjustment_history(store_id);
CREATE INDEX idx_stock_adjustment_history_created_at ON public.stock_adjustment_history(created_at DESC);
