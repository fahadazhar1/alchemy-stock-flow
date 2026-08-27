-- Revert VACUUM FULL back to weekly (Sunday 3am UTC)
SELECT cron.unschedule('vacuum-tracking-events');
SELECT cron.schedule(
  'vacuum-tracking-events',
  '0 3 * * 0',
  'VACUUM FULL shipment_tracking_events'
);
