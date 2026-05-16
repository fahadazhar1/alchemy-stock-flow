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
  return /^\d{15}$/.test(tn) ? "mandp" : "sonic";
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ─── SONIC ────────────────────────────────────────────────────────────────────

async function fetchFromSonic(tn: string) {
  const headers = { "Authorization": SONIC_API_KEY };
  const enc     = encodeURIComponent(tn);
  try {
    const [statusRes, chargesRes, paymentsRes] = await Promise.all([
      fetch(`https://sonic.pk/api/shipment/status?tracking_number=${enc}&type=0`,  { headers, signal: AbortSignal.timeout(10_000) }),
      fetch(`https://sonic.pk/api/shipment/charges?tracking_number=${enc}`,        { headers, signal: AbortSignal.timeout(10_000) }),
      fetch(`https://sonic.pk/api/shipment/payments?tracking_number=${enc}`,       { headers, signal: AbortSignal.timeout(10_000) }),
    ]);
    const [statusData, chargesData, paymentsData] = await Promise.all([
      statusRes.ok   ? statusRes.json()   : null,
      chargesRes.ok  ? chargesRes.json()  : null,
      paymentsRes.ok ? paymentsRes.json() : null,
    ]);

    if (!statusData || statusData.status !== 0) return null;

    const c = chargesData?.status === 0 ? chargesData.charges : null;
    const paymentStatus: string | null = paymentsData?.status === 0
      ? paymentsData?.current_payment_status ?? null
      : null;

    let remittanceDate: string | null = null;
    if (paymentsData?.status === 0) {
      const rawDate: string | null = paymentsData?.payments?.[0]?.datetime ?? null;
      if (rawDate) {
        const d = new Date(rawDate);
        remittanceDate = !isNaN(d.getTime()) ? d.toISOString() : rawDate;
      }
    }

    return {
      courier_status:         statusData.current_status ?? null,
      courier_payment_status: paymentStatus,
      shipping_charges:       toNum(c?.total_charges),
      fuel_surcharge:         toNum(c?.fuel_surcharge),
      gst:                    toNum(c?.gst),
      remittance_date:        remittanceDate,
    };
  } catch {
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

    const events: any[]  = details.CNTrackingDetail ?? [];
    const lastEvent      = events[events.length - 1];
    const amountPaid     = Number(details.AmountPaid ?? 0);
    const paymentStatus  = (details.PaymentID != null || amountPaid > 0) ? "Paid" : "Unpaid";

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
      remittance_date:        remittanceDate,
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

    // Fetch the next batch of active tracking numbers that need syncing
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

      // Always write last_synced_at even on failure so the queue advances past this number
      const row = {
        tracking_number: tn,
        courier,
        ...(fetched ?? {}),
        last_synced_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("sonic_cache")
        .upsert(row, { onConflict: "tracking_number" });

      if (!fetched || error) { failed++; } else { synced++; }
    }

    // Process in parallel groups to stay within timeout
    for (let i = 0; i < trackingNumbers.length; i += CONCURRENT) {
      await Promise.all(
        trackingNumbers.slice(i, i + CONCURRENT).map(processOne)
      );
    }

    return json(200, { ok: true, synced, failed, total: trackingNumbers.length });
  } catch (e) {
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
