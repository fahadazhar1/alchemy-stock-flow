CREATE TABLE bundle_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  product_a_id text NOT NULL,
  product_a_name text NOT NULL,
  product_a_sku text NOT NULL,
  product_b_id text NOT NULL,
  product_b_name text NOT NULL,
  product_b_sku text NOT NULL,
  co_occurrence_count integer,
  estimated_bundle_revenue numeric,
  saved_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz DEFAULT NULL
);

ALTER TABLE bundle_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full access"
  ON bundle_suggestions FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
