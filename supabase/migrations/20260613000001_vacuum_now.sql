-- Temporarily run VACUUM FULL every minute so it fires immediately
-- (reverted to weekly in next migration once it completes)
SELECT cron.unschedule('vacuum-tracking-events');
SELECT cron.schedule(
  'vacuum-tracking-events',
  '* * * * *',
  'VACUUM FULL shipment_tracking_events'
);
