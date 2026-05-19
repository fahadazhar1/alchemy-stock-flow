-- Clear any in_progress or failed sync logs so the next sync starts fresh.
-- Required because resume picks up the old Shopify cursor (created_at_min=2026-01-01),
-- which would skip the 3-year historical backfill we just enabled.
UPDATE public.shopify_sync_logs
SET status = 'cancelled'
WHERE status IN ('in_progress', 'failed');
