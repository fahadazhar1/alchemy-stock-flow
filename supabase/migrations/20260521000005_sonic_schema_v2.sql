-- ============================================================================
-- SONIC SCHEMA V2 — Production-grade courier integration upgrade
-- ============================================================================
--
-- Fixes critical issues:
--   1. get_active_tracking_to_sync excluded delivered-but-unpaid orders → payment
--      status was NEVER updated after delivery. Fixed: re-sync delivered orders
--      where courier_payment_status is not yet confirmed as paid/processed.
--
--   2. Missing charge columns in sonic_cache: return_charges, cash_handling_charges,
--      insurance_charges, intercept_charges, adjustment_charges.
--
--   3. New table: shipment_tracking_events — stores full timeline history instead of
--      overwriting the single status row on every cron tick.
--
--   4. New table: webhook_logs — idempotent audit log for all incoming courier webhooks.
--
--   5. New table: courier_settlements — records each SONIC remittance batch payout.
--
--   6. New table: reconciliation_differences — stores per-order variance between
--      courier-reported amounts and internally-calculated amounts.
--
--   7. New columns on sonic_cache: internally_calculated_net, courier_reported_net,
--      variance, reconciliation_status — never trust the courier settlement blindly.
--
-- ============================================================================

-- ── 1. Additional charge columns on sonic_cache ──────────────────────────────
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS cash_handling_charges numeric;
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS return_charges         numeric;
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS insurance_charges      numeric;
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS intercept_charges      numeric;
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS adjustment_charges     numeric;
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS other_deductions       numeric;

-- Dual-amount reconciliation columns
-- internally_calculated_net = what WE compute using our formula
-- courier_reported_net      = what the courier claims in their settlement
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS internally_calculated_net numeric;
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS courier_reported_net       numeric;
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS reconciliation_status      text    DEFAULT 'pending';
  -- values: 'pending' | 'matched' | 'variance' | 'disputed'
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS reconciliation_variance    numeric GENERATED ALWAYS AS
  (CASE WHEN internally_calculated_net IS NOT NULL AND courier_reported_net IS NOT NULL
        THEN internally_calculated_net - courier_reported_net
        ELSE NULL
   END) STORED;

-- Shipment type flags
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS is_rts              boolean DEFAULT false; -- Return to Sender
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS is_replaced         boolean DEFAULT false; -- Replacement shipment
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS is_try_buy          boolean DEFAULT false; -- Try & Buy
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS try_buy_charges     numeric;
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS replacement_charges numeric;

-- Charge lifecycle: SONIC issues initial charges at booking, final charges after delivery
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS initial_charges_captured_at timestamptz;
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS final_charges_captured_at   timestamptz;
ALTER TABLE sonic_cache ADD COLUMN IF NOT EXISTS charges_revised             boolean DEFAULT false;

-- ── 2. shipment_tracking_events ───────────────────────────────────────────────
-- Full timeline of courier status updates. One row per event, never overwritten.
-- The cron writes new events; the latest event matches sonic_cache.courier_status.
CREATE TABLE IF NOT EXISTS shipment_tracking_events (
  id              bigserial PRIMARY KEY,
  tracking_number text        NOT NULL,
  courier         text        NOT NULL DEFAULT 'sonic',
  status          text        NOT NULL,
  event_at        timestamptz,          -- timestamp from courier API (NULL if not provided)
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  location        text,
  remarks         text,
  raw_payload     jsonb,                -- raw status object from courier API for debugging
  UNIQUE (tracking_number, status, event_at) -- idempotency: same event never inserted twice
);

CREATE INDEX IF NOT EXISTS idx_ste_tracking    ON shipment_tracking_events (tracking_number);
CREATE INDEX IF NOT EXISTS idx_ste_recorded_at ON shipment_tracking_events (recorded_at DESC);

-- ── 3. webhook_logs ───────────────────────────────────────────────────────────
-- Idempotent log of every incoming webhook event from SONIC.
-- processed = false means the event is queued for processing.
-- Retry logic reads unprocessed events.
CREATE TABLE IF NOT EXISTS webhook_logs (
  id               bigserial PRIMARY KEY,
  source           text        NOT NULL DEFAULT 'sonic',  -- 'sonic' | 'mandp'
  event_type       text        NOT NULL,  -- 'delivery_status' | 'payment_status' | 'initial_charges' | 'final_charges'
  tracking_number  text,
  idempotency_key  text        UNIQUE,    -- deduplicate re-delivered webhooks
  raw_payload      jsonb       NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  processed        boolean     NOT NULL DEFAULT false,
  processed_at     timestamptz,
  error            text,                  -- last processing error (dead letter support)
  retry_count      int         NOT NULL DEFAULT 0,
  signature_valid  boolean,               -- result of HMAC verification
  ip_address       inet
);

CREATE INDEX IF NOT EXISTS idx_whl_unprocessed ON webhook_logs (processed, received_at) WHERE processed = false;
CREATE INDEX IF NOT EXISTS idx_whl_tracking    ON webhook_logs (tracking_number);

-- ── 4. courier_settlements ────────────────────────────────────────────────────
-- One row per SONIC payout/remittance batch. SONIC remits COD in periodic batches.
-- "courier_reported_total" = sum according to SONIC's remittance advice
-- "our_calculated_total"   = sum of our net_receivable for all shipments in this batch
CREATE TABLE IF NOT EXISTS courier_settlements (
  id                      bigserial PRIMARY KEY,
  courier                 text        NOT NULL DEFAULT 'sonic',
  settlement_reference    text        UNIQUE,  -- SONIC's invoice/payment reference number
  settlement_date         date,
  store_id                uuid        REFERENCES stores(id),
  courier_reported_total  numeric     NOT NULL DEFAULT 0,
  our_calculated_total    numeric     NOT NULL DEFAULT 0,
  variance                numeric GENERATED ALWAYS AS (courier_reported_total - our_calculated_total) STORED,
  status                  text        NOT NULL DEFAULT 'pending',
  -- values: 'pending' | 'matched' | 'variance' | 'disputed' | 'accepted'
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  reconciled_at           timestamptz
);

-- ── 5. courier_settlement_items ───────────────────────────────────────────────
-- Shipment-level detail inside a settlement batch
CREATE TABLE IF NOT EXISTS courier_settlement_items (
  id                     bigserial PRIMARY KEY,
  settlement_id          bigint      NOT NULL REFERENCES courier_settlements(id),
  tracking_number        text        NOT NULL,
  order_number           text,
  courier_reported_net   numeric,    -- what SONIC says it remitted for this shipment
  our_calculated_net     numeric,    -- our formula result
  variance               numeric GENERATED ALWAYS AS (courier_reported_net - our_calculated_net) STORED,
  reconciliation_status  text        NOT NULL DEFAULT 'pending',
  notes                  text,
  UNIQUE (settlement_id, tracking_number)
);

-- ── 6. reconciliation_differences ─────────────────────────────────────────────
-- Persistent record of discrepancies found during reconciliation.
-- Separate from courier_settlement_items so ad-hoc discrepancies can be recorded
-- outside of a formal settlement batch.
CREATE TABLE IF NOT EXISTS reconciliation_differences (
  id                    bigserial PRIMARY KEY,
  tracking_number       text        NOT NULL,
  order_number          text,
  difference_type       text        NOT NULL,
  -- 'cod_mismatch' | 'charge_revision' | 'missing_payment' | 'duplicate_payment'
  -- 'rts_not_reconciled' | 'wrong_deduction' | 'extra_deduction' | 'invoice_discrepancy'
  our_amount            numeric,
  courier_amount        numeric,
  variance              numeric GENERATED ALWAYS AS (our_amount - courier_amount) STORED,
  detected_at           timestamptz NOT NULL DEFAULT now(),
  resolved_at           timestamptz,
  resolution_notes      text,
  status                text        NOT NULL DEFAULT 'open',
  -- values: 'open' | 'under_review' | 'accepted' | 'disputed' | 'resolved'
  settlement_id         bigint      REFERENCES courier_settlements(id)
);

CREATE INDEX IF NOT EXISTS idx_rd_tracking ON reconciliation_differences (tracking_number);
CREATE INDEX IF NOT EXISTS idx_rd_status   ON reconciliation_differences (status) WHERE status = 'open';

-- ── 7. Fix get_active_tracking_to_sync ───────────────────────────────────────
-- ROOT CAUSE: delivered orders were excluded entirely. This meant once SONIC
-- confirmed delivery, the courier_payment_status was never updated from
-- "Pending" to "Payment - Processed". COD receivables were stuck as "held"
-- forever for delivered orders.
--
-- FIX: add a third sync condition — re-sync delivered orders every 30 minutes
-- until their payment status confirms as paid/processed.
CREATE OR REPLACE FUNCTION get_active_tracking_to_sync(batch_limit int DEFAULT 50)
RETURNS TABLE(tracking_number text)
LANGUAGE sql STABLE
AS $$
  SELECT sub.tracking_number
  FROM (
    SELECT DISTINCT ON (o.tracking_number) o.tracking_number, sc.last_synced_at
    FROM   orders o
    JOIN   stores s ON s.id = o.store_id
    LEFT   JOIN sonic_cache sc ON sc.tracking_number = o.tracking_number

    WHERE  o.tracking_number IS NOT NULL
      AND  o.cancelled_at    IS NULL
      AND  s.currency        = 'PKR'
      -- Real tracking numbers only (no "LCS", "DHL", single-char values)
      AND  o.tracking_number ~ '^[A-Za-z0-9][A-Za-z0-9\-]{4,}$'
      AND  (
        -- Never synced: highest priority
        sc.tracking_number IS NULL

        -- Active (pre-terminal) shipments: re-sync every 5 minutes
        OR (
          sc.last_synced_at < now() - interval '5 minutes'
          AND sc.courier_status IS NOT NULL
          AND sc.courier_status NOT ILIKE '%delivered%'
          AND sc.courier_status NOT ILIKE '%return%'
          AND sc.courier_status NOT ILIKE '%cancelled%'
        )

        -- ── NEW: Delivered but payment NOT yet confirmed ──────────────────
        -- SONIC remits COD days/weeks after delivery. We must keep polling
        -- until courier_payment_status flips to paid/processed.
        -- Re-sync every 30 minutes (less aggressive than pre-delivery polling).
        OR (
          sc.last_synced_at < now() - interval '30 minutes'
          AND sc.courier_status ILIKE '%delivered%'
          AND (
            sc.courier_payment_status IS NULL
            OR NOT (
              sc.courier_payment_status ILIKE '%processed%'
              OR sc.courier_payment_status ILIKE '%paid%'
            )
          )
        )
      )

    ORDER BY o.tracking_number, sc.last_synced_at ASC NULLS FIRST
  ) sub
  ORDER BY sub.last_synced_at ASC NULLS FIRST
  LIMIT  batch_limit;
$$;

GRANT EXECUTE ON FUNCTION get_active_tracking_to_sync(int) TO authenticated, anon;

-- ── 8. RLS for new tables ─────────────────────────────────────────────────────
ALTER TABLE shipment_tracking_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE courier_settlements       ENABLE ROW LEVEL SECURITY;
ALTER TABLE courier_settlement_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_differences ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all tables (service role bypasses RLS for writes)
CREATE POLICY "auth read tracking events"   ON shipment_tracking_events   FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read webhook logs"      ON webhook_logs               FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read settlements"       ON courier_settlements        FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read settlement items"  ON courier_settlement_items   FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read reconciliation"    ON reconciliation_differences FOR SELECT TO authenticated USING (true);

-- ── 9. Helper: record tracking event (idempotent) ────────────────────────────
-- Called by cron + webhook handler. The UNIQUE constraint prevents duplicates.
CREATE OR REPLACE FUNCTION record_tracking_event(
  p_tracking_number text,
  p_courier         text,
  p_status          text,
  p_event_at        timestamptz DEFAULT NULL,
  p_location        text        DEFAULT NULL,
  p_remarks         text        DEFAULT NULL,
  p_raw_payload     jsonb       DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO shipment_tracking_events
    (tracking_number, courier, status, event_at, location, remarks, raw_payload)
  VALUES
    (p_tracking_number, p_courier, p_status, p_event_at, p_location, p_remarks, p_raw_payload)
  ON CONFLICT (tracking_number, status, event_at) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION record_tracking_event(text,text,text,timestamptz,text,text,jsonb) TO authenticated, anon;
