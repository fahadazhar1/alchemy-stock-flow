-- Reset sync so all stores re-sync from 3 years back.
-- Required after extending the order sync window from current-year-only to 3 years,
-- so historical orders are fetched and returning customers are correctly identified.
UPDATE public.shopify_connections
SET last_sync_at = NULL
WHERE last_sync_at IS NOT NULL;
