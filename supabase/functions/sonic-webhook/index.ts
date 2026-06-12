/**
 * sonic-webhook — receives real-time push events from SONIC Courier.
 *
 * SONIC only provides an API key (no webhook signature/HMAC).
 * Security model: a secret token is embedded in the webhook URL as a query param.
 *   Register URL: .../sonic-webhook?token=<SONIC_WEBHOOK_TOKEN>
 *   Set SONIC_WEBHOOK_TOKEN env var to a random secret string.
 *   Anyone without the token gets a 401.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Token embedded in the webhook URL — e.g. ?token=abc123
// If not set, the endpoint is open (acceptable only during initial testing)
const WEBHOOK_TOKEN   = Deno.env.get("SONIC_WEBHOOK_TOKEN") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sonic-signature",
};

// ─── URL token verification ───────────────────────────────────────────────────
// SONIC doesn't sign payloads. We protect the endpoint by embedding a secret
// token in the URL: .../sonic-webhook?token=<SONIC_WEBHOOK_TOKEN>
// Constant-time comparison prevents timing attacks.
function verifyToken(requestToken: string | null): boolean {
  if (!WEBHOOK_TOKEN) return true; // not configured — open during initial setup
  if (!requestToken)  return false;
  // Constant-time compare to avoid timing side-channels
  if (requestToken.length !== WEBHOOK_TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < WEBHOOK_TOKEN.length; i++) {
    diff |= requestToken.charCodeAt(i) ^ WEBHOOK_TOKEN.charCodeAt(i);
  }
  return diff === 0;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return isNaN(n) ? null : n;
}

function buildIdempotencyKey(payload: Record<string, unknown>): string {
  // Build a stable key from the core identifiers in the webhook
  const tn   = payload.tracking_number ?? payload.trackingNumber ?? payload.cn ?? "";
  const type = payload.event_type ?? payload.eventType ?? payload.status ?? "";
  const ts   = payload.timestamp ?? payload.datetime ?? payload.event_time ?? "";
  return `sonic:${tn}:${type}:${ts}`;
}

// ─── Processors ───────────────────────────────────────────────────────────────

async function processDeliveryStatus(
  supabase: ReturnType<typeof createClient>,
  tn: string,
  payload: Record<string, unknown>,
) {
  const status    = (payload.status ?? payload.current_status ?? payload.shipment_status) as string | null;
  const eventTime = payload.datetime ?? payload.event_time ?? null;
  if (!status) return;

  let eventAt: string | null = null;
  if (eventTime) {
    const d = new Date(eventTime as string);
    eventAt = !isNaN(d.getTime()) ? d.toISOString() : null;
  }

  // 1. Update sonic_cache with latest status
  await supabase
    .from("sonic_cache")
    .upsert({
      tracking_number: tn,
      courier: "sonic",
      courier_status: status,
      last_synced_at: new Date().toISOString(),
    }, { onConflict: "tracking_number" });

  // 2. Record timeline event (idempotent)
  await supabase.rpc("record_tracking_event", {
    p_tracking_number: tn,
    p_courier:         "sonic",
    p_status:          status,
    p_event_at:        eventAt ?? undefined,
    p_location:        (payload.location as string | undefined) ?? undefined,
  });
}

async function processPaymentStatus(
  supabase: ReturnType<typeof createClient>,
  tn: string,
  payload: Record<string, unknown>,
) {
  const paymentStatus = (payload.payment_status ?? payload.current_payment_status) as string | null;
  const codAmount     = toNum(payload.cod_amount ?? payload.amount);
  const wht           = toNum(payload.wht);
  const codSst        = toNum(payload.cod_sst);
  const remittanceDate = payload.datetime ?? payload.payment_date ?? null;

  let remittanceDateISO: string | null = null;
  if (remittanceDate) {
    const d = new Date(remittanceDate as string);
    remittanceDateISO = !isNaN(d.getTime()) ? d.toISOString() : null;
  }

  const patch: Record<string, unknown> = {
    last_synced_at: new Date().toISOString(),
  };
  if (paymentStatus)          patch.courier_payment_status = paymentStatus;
  if (codAmount !== null)     patch.cod_amount             = codAmount;
  if (wht !== null)           patch.wht                    = wht;
  if (codSst !== null)        patch.cod_sst                = codSst;
  if (remittanceDateISO)      patch.remittance_date        = remittanceDateISO;

  await supabase
    .from("sonic_cache")
    .upsert({ tracking_number: tn, courier: "sonic", ...patch }, { onConflict: "tracking_number" });
}

async function processCharges(
  supabase: ReturnType<typeof createClient>,
  tn: string,
  payload: Record<string, unknown>,
  isFinal: boolean,
) {
  const weightCharges  = toNum(payload.weight_charges);
  const fuelSurcharge  = toNum(payload.fuel_surcharge);
  const gst            = toNum(payload.gst);
  const cashHandling   = toNum(payload.cash_handling_charges);
  const returnCharges  = toNum(payload.return_charges);
  const insuranceChg   = toNum(payload.insurance_charges);
  const interceptChg   = toNum(payload.intercept_charges);
  const adjustmentChg  = toNum(payload.adjustment_charges);
  const courierNet     = toNum(payload.net_payable ?? payload.net_receivable);

  const patch: Record<string, unknown> = {
    last_synced_at: new Date().toISOString(),
  };

  if (weightCharges  !== null) patch.shipping_charges       = weightCharges;
  if (fuelSurcharge  !== null) patch.fuel_surcharge         = fuelSurcharge;
  if (gst            !== null) patch.gst                    = gst;
  if (cashHandling   !== null) patch.cash_handling_charges  = cashHandling;
  if (returnCharges  !== null) patch.return_charges         = returnCharges;
  if (insuranceChg   !== null) patch.insurance_charges      = insuranceChg;
  if (interceptChg   !== null) patch.intercept_charges      = interceptChg;
  if (adjustmentChg  !== null) patch.adjustment_charges     = adjustmentChg;
  if (courierNet     !== null) patch.courier_reported_net   = courierNet;

  if (isFinal) {
    patch.final_charges_captured_at = new Date().toISOString();
  } else {
    patch.initial_charges_captured_at = new Date().toISOString();
  }

  // Flag if this is a charge revision (final charges differ from initial)
  if (isFinal) {
    const { data: existing } = await supabase
      .from("sonic_cache")
      .select("shipping_charges, fuel_surcharge, gst")
      .eq("tracking_number", tn)
      .single();

    if (existing) {
      const prevTotal = (existing.shipping_charges ?? 0) + (existing.fuel_surcharge ?? 0) + (existing.gst ?? 0);
      const newTotal  = (weightCharges ?? 0) + (fuelSurcharge ?? 0) + (gst ?? 0);
      if (prevTotal > 0 && Math.abs(prevTotal - newTotal) > 1) {
        patch.charges_revised = true;

        // Log the discrepancy for reconciliation
        await supabase
          .from("reconciliation_differences")
          .insert({
            tracking_number:  tn,
            difference_type:  "charge_revision",
            our_amount:       prevTotal,
            courier_amount:   newTotal,
            status:           "open",
          })
          .throwOnError();
      }
    }
  }

  await supabase
    .from("sonic_cache")
    .upsert({ tracking_number: tn, courier: "sonic", ...patch }, { onConflict: "tracking_number" });
}

// ─── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ok = (msg?: string) =>
    new Response(JSON.stringify({ ok: true, message: msg ?? "received" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  const err = (status: number, message: string) =>
    new Response(JSON.stringify({ ok: false, error: message }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // Verify URL token BEFORE reading body
  const url          = new URL(req.url);
  const requestToken = url.searchParams.get("token");
  const tokenValid   = verifyToken(requestToken);
  const clientIp     = req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? null;

  if (!tokenValid) {
    return err(401, "Unauthorized");
  }

  const bodyText = await req.text().catch(() => "{}");

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return err(400, "Invalid JSON");
  }

  const trackingNumber = (payload.tracking_number ?? payload.trackingNumber ?? payload.cn ?? "") as string;
  const eventType      = (payload.event_type ?? payload.eventType ?? "unknown") as string;
  const idempotencyKey = buildIdempotencyKey(payload);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ── Log webhook immediately (always, even if signature invalid) ────────────
  // We log everything for audit purposes; invalid-signature events are flagged.
  const { data: logRow, error: logError } = await supabase
    .from("webhook_logs")
    .insert({
      source:           "sonic",
      event_type:       eventType,
      tracking_number:  trackingNumber || null,
      idempotency_key:  idempotencyKey,
      raw_payload:      payload,
      signature_valid:  tokenValid,
      ip_address:       clientIp,
    })
    .select("id")
    .single();

  // Idempotency: duplicate key = already processed
  if (logError?.code === "23505") {
    return ok("duplicate — already processed");
  }

  if (logError) {
    console.error("[webhook] log insert error:", logError.message);
    // Still return 200 to prevent SONIC retrying a webhook we can't log
    return ok("logged with error");
  }

  if (!trackingNumber) {
    await supabase
      .from("webhook_logs")
      .update({ error: "missing tracking_number", processed: true, processed_at: new Date().toISOString() })
      .eq("id", logRow.id);
    return ok("no tracking number — ignored");
  }

  // ── Process the event ──────────────────────────────────────────────────────
  let processingError: string | null = null;
  try {
    const lowerType = eventType.toLowerCase();

    if (lowerType.includes("delivery") || lowerType.includes("status") || lowerType.includes("tracking")) {
      await processDeliveryStatus(supabase, trackingNumber, payload);
    } else if (lowerType.includes("payment") || lowerType.includes("remittance")) {
      await processPaymentStatus(supabase, trackingNumber, payload);
    } else if (lowerType.includes("final_charge") || lowerType.includes("finalcharge")) {
      await processCharges(supabase, trackingNumber, payload, true);
    } else if (lowerType.includes("initial_charge") || lowerType.includes("initialcharge") || lowerType.includes("charge")) {
      await processCharges(supabase, trackingNumber, payload, false);
    } else {
      // Unknown event type — logged but not processed; will not cause retry
      console.warn(`[webhook] unknown event type: ${eventType} for ${trackingNumber}`);
    }
  } catch (e) {
    processingError = e instanceof Error ? e.message : String(e);
    console.error(`[webhook] processing error for ${trackingNumber}:`, processingError);
  }

  // ── Mark log as processed ──────────────────────────────────────────────────
  await supabase
    .from("webhook_logs")
    .update({
      processed:    processingError === null,
      processed_at: new Date().toISOString(),
      error:        processingError,
    })
    .eq("id", logRow.id);

  // Always return 200 — SONIC must not retry successfully-received webhooks.
  // Processing errors are handled internally (retry queue via webhook_logs).
  return ok(processingError ? `processed with error: ${processingError}` : undefined);
});
