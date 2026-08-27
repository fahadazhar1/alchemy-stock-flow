-- sonic_cache has RLS enabled but no SELECT policy, so the browser client
-- reads 0 rows (cron writes succeed via service_role which bypasses RLS).
-- Grant read access to all authenticated and anon roles — this table only
-- contains courier tracking status data, nothing sensitive.
ALTER TABLE sonic_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sonic_cache_select"
  ON sonic_cache FOR SELECT
  USING (true);
