import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SONIC_API_KEY = Deno.env.get("SONIC_API_KEY")!;
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CONCURRENT = 5; // parallel courier API calls per batch

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectCourier(tn: string): "mandp" | "sonic" {
  return /^560\d{12}$/.test(tn) ? "mandp" : "sonic";
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  // Handle comma-formatted strings like "1,680.20"
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return isNaN(n) ? null : n;
}

// ─── SONIC ────────────────────────────────────────────────────────────────────
// CRITICAL: must match the logic in sonic-tracking/index.ts exactly.
// Both functions write to sonic_cache — any divergence causes data corruption.

async function fetchFromSonic(tn: string) {
  const headers = { "Authorization": SONIC_API_KEY };
  const enc     = encodeURIComponent(tn);
  try {
    const [trackRes, chargesRes, paymentsRes] = await Promise.all([
      fetch(`https://sonic.pk/api/shipment/track?tracking_number=${enc}&type=0`,
        { headers, signal: AbortSignal.timeout(10_000) }),
      fetch(`https://sonic.pk/api/shipment/charges?tracking_number=${enc}`,
        { headers, signal: AbortSignal.timeout(10_000) }),
      fetch(`https://sonic.pk/api/shipment/payments?tracking_number=${enc}`,
        { headers, signal: AbortSignal.timeout(10_000) }),
    ]);

    const [trackData, chargesData, paymentsData] = await Promise.all([
      trackRes.ok    ? trackRes.json()    : null,
      chargesRes.ok  ? chargesRes.json()  : null,
      paymentsRes.ok ? paymentsRes.json() : null,
    ]);

    if (!trackData || trackData.status !== 0) return null;

    const details  = trackData.details;
    const history: any[] = details?.tracking_history ?? [];
    const currentStatus  = history[0]?.status ?? null;

    // /charges endpoint — use weight_charges directly (NOT total_charges).
    // total_charges = weight + fuel (excludes GST). weight_charges is the base
    // freight line item. Previous versions used total_charges here — that was wrong.
    const c             = chargesData?.status === 0 ? chargesData.charges : null;
    const weightCharges = toNum(c?.weight_charges);     // e.g. 300 — base freight
    const fuelSurcharge = toNum(c?.fuel_surcharge);     // e.g. 105
    const cashHandling  = toNum(c?.cash_handling_charges);
    const returnCharges = toNum(c?.return_charges);
    const insuranceChg  = toNum(c?.insurance_charges);

    // /payments endpoint — two distinct entry types:
    //   charge entry  (amount ≈ 0, type 3): delivery fee billed to shipper, has actual billed GST
    //   remittance entry (amount > 0, type 0): COD collected, has WHT + COD SST + actual amount
    //
    // PREVIOUS BUG: code read payments[0].amount which is the charge entry (amount=0).
    // FIX: find the entry where amount > 0.
    const payments: any[] = paymentsData?.status === 0 ? (paymentsData.payments ?? []) : [];
    const chargeEntry     = payments.find((p: any) => (toNum(p.amount) ?? 0) <= 0);
    const remittanceEntry = payments.find((p: any) => (toNum(p.amount) ?? 0) > 0);

    // Actual billed GST from payments charge entry (more accurate than /charges estimate)
    const gstActual = chargeEntry
      ? toNum(chargeEntry.gst)
      : toNum(c?.gst); // fall back to /charges estimate if not yet billed

    const paymentStatus: string | null = paymentsData?.status === 0
      ? paymentsData?.current_payment_status ?? null
      : null;

    // COD amount: actual collected from remittance entry, fall back to booked amount
    const bookedAmount = toNum(details?.order_information?.amount);
    const codAmount    = remittanceEntry ? toNum(remittanceEntry.amount) : bookedAmount;

    // WHT (2% of COD) and COD SST (2% of COD) from remittance entry
    // Fall back to top-level payments.charges if remittance entry not yet present
    const wht    = toNum(remittanceEntry?.wht)     ?? toNum(paymentsData?.charges?.wht);
    const codSst = toNum(remittanceEntry?.cod_sst) ?? toNum(paymentsData?.charges?.cod_sst);

    let remittanceDate: string | null = null;
    const rawDate: string | null = remittanceEntry?.datetime ?? null;
    if (rawDate) {
      const d = new Date(rawDate);
      remittanceDate = !isNaN(d.getTime()) ? d.toISOString() : rawDate;
    }

    // Compute our internally-calculated net receivable
    // net = cod_amount - wht - cod_sst - weight - fuel - gst - other charges
    const internalNet = codAmount != null
      ? codAmount
        - (wht ?? 0)
        - (codSst ?? 0)
        - (weightCharges ?? 0)
        - (fuelSurcharge ?? 0)
        - (gstActual ?? 0)
        - (cashHandling ?? 0)
        - (returnCharges ?? 0)
        - (insuranceChg ?? 0)
      : null;

    return {
      courier_status:            currentStatus,
      courier_payment_status:    paymentStatus,
      shipping_charges:          weightCharges,   // weight charges (base freight)
      fuel_surcharge:            fuelSurcharge,
      gst:                       gstActual,       // actual billed (from payments), not estimate
      cod_amount:                codAmount,
      wht,
      cod_sst:                   codSst,
      remittance_date:           remittanceDate,
      cash_handling_charges:     cashHandling,
      return_charges:            returnCharges,
      insurance_charges:         insuranceChg,
      internally_calculated_net: internalNet,
      // tracking_history returned separately for event recording
      _tracking_history:         history,
    };
  } catch (e) {
    console.error(`[SONIC cron] fetch error for ${tn}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ─── M&P ──────────────────────────────────────────────────────────────────────

async function fetchFromMandP(cn: string) {
  try {
    const res = await fetch(
      `https://tracking.mulphilog.com.pk/api/CNTracking?consignment=${encodeURIComponent(cn)}&id=4`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return null;
    const json  = await res.json();
    const entry = json?.[0];
    if (String(entry?.isSuccess) !== "true") return null;
    const details = entry.tracking_Details?.[0];
    if (!details) return null;

    const events: any[] = details.CNTrackingDetail ?? [];
    const lastEvent     = events[events.length - 1];
    const amountPaid    = Number(details.AmountPaid ?? 0);
    const paymentStatus = (details.PaymentID != null || amountPaid > 0) ? "Paid" : "Unpaid";

    let remittanceDate: string | null = null;
    const rawDate: string | null = details.PaymentDate ?? details.PaymentDateTime ?? null;
    if (rawDate) {
      const d = new Date(rawDate);
      remittanceDate = !isNaN(d.getTime()) ? d.toISOString() : rawDate;
    }

    const inv = details.CNTrackingInvDetail?.[0];

    return {
      courier_status:         lastEvent?.TrackingStatus ?? null,
      courier_payment_status: paymentStatus,
      shipping_charges:       toNum(inv?.AmountInvoiced),
      fuel_surcharge:         null,
      gst:                    null,
      cod_amount:             amountPaid > 0 ? amountPaid : null,
      wht:                    null,
      cod_sst:                null,
      remittance_date:        remittanceDate,
      _tracking_history:      events.map((e: any) => ({
        status:   e.TrackingStatus ?? null,
        event_at: e.EventDateTime ?? null,
        location: e.Location ?? null,
      })),
    };
  } catch {
    return null;
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: rows, error: rpcError } = await supabase
      .rpc("get_active_tracking_to_sync", { batch_limit: 50 });
    if (rpcError) throw rpcError;

    const trackingNumbers: string[] = ((rows ?? []) as any[])
      .map((r: any) => r.tracking_number)
      .filter(Boolean);

    if (!trackingNumbers.length) {
      return json(200, { ok: true, synced: 0, failed: 0, message: "Nothing to sync" });
    }

    let synced = 0;
    let failed = 0;

    async function processOne(tn: string) {
      const courier = detectCourier(tn);
      const fetched = courier === "mandp"
        ? await fetchFromMandP(tn)
        : await fetchFromSonic(tn);

      // Strip internal-only fields before writing to sonic_cache
      const { _tracking_history, ...cacheData } = (fetched ?? {}) as any;

      // Always write last_synced_at even on failure so the queue advances
      const row = {
        tracking_number: tn,
        courier,
        ...cacheData,
        last_synced_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("sonic_cache")
        .upsert(row, { onConflict: "tracking_number" });

      if (!fetched || error) {
        failed++;
        if (error) console.error(`[SONIC cron] upsert error for ${tn}:`, error.message);
        return;
      }

      synced++;

      // Record tracking events for timeline history (idempotent — DB UNIQUE constraint prevents dupes)
      if (_tracking_history?.length) {
        for (const event of _tracking_history) {
          if (!event.status) continue;
          let eventAt: string | null = null;
          if (event.datetime ?? event.event_at) {
            const d = new Date(event.datetime ?? event.event_at);
            eventAt = !isNaN(d.getTime()) ? d.toISOString() : null;
          }
          // Fire-and-forget — don't let event recording failures break the main sync
          supabase.rpc("record_tracking_event", {
            p_tracking_number: tn,
            p_courier:         courier,
            p_status:          event.status,
            p_event_at:        eventAt ?? undefined,
            p_location:        event.location ?? undefined,
            p_raw_payload:     event,
          }).then(({ error: e }) => {
            if (e) console.warn(`[SONIC cron] event record failed ${tn}:`, e.message);
          });
        }
      }
    }

    // Process in parallel groups to stay within the 30s edge function timeout
    for (let i = 0; i < trackingNumbers.length; i += CONCURRENT) {
      await Promise.all(
        trackingNumbers.slice(i, i + CONCURRENT).map(processOne)
      );
    }

    return json(200, { ok: true, synced, failed, total: trackingNumbers.length });
  } catch (e) {
    console.error("[SONIC cron] fatal error:", e instanceof Error ? e.message : e);
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
