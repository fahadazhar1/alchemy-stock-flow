import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SONIC_API_KEY = Deno.env.get("SONIC_API_KEY")!;
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CACHE_TTL_MS  = 2 * 60 * 60 * 1000; // 2 hours

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type CourierData = {
  courier_status:         string | null;
  courier_payment_status: string | null;
  shipping_charges:       number | null;
  fuel_surcharge:         number | null;
  gst:                    number | null;
  remittance_date:        string | null;
};

// M&P CN numbers are always 15-digit numeric strings
function detectCourier(tn: string): "mandp" | "sonic" {
  return /^\d{15}$/.test(tn) ? "mandp" : "sonic";
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ─── SONIC ────────────────────────────────────────────────────────────────────
async function fetchFromSonic(tn: string): Promise<CourierData | null> {
  const headers = { "Authorization": SONIC_API_KEY };
  const enc     = encodeURIComponent(tn);

  try {
    // All three SONIC endpoints in parallel — status, charges, payment details
    const [statusRes, chargesRes, paymentsRes] = await Promise.all([
      fetch(`https://sonic.pk/api/shipment/status?tracking_number=${enc}&type=0`, { headers, signal: AbortSignal.timeout(10_000) }),
      fetch(`https://sonic.pk/api/shipment/charges?tracking_number=${enc}`,       { headers, signal: AbortSignal.timeout(10_000) }),
      fetch(`https://sonic.pk/api/shipment/payments?tracking_number=${enc}`,      { headers, signal: AbortSignal.timeout(10_000) }),
    ]);

    const [statusData, chargesData, paymentsData] = await Promise.all([
      statusRes.ok   ? statusRes.json()   : null,
      chargesRes.ok  ? chargesRes.json()  : null,
      paymentsRes.ok ? paymentsRes.json() : null,
    ]);

    if (!statusData || statusData.status !== 0) return null;

    const c = chargesData?.status === 0 ? chargesData.charges : null;
    const shippingCharges = toNum(c?.total_charges);
    const fuelSurcharge   = toNum(c?.fuel_surcharge);
    const gst             = toNum(c?.gst);

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
      shipping_charges:       shippingCharges,
      fuel_surcharge:         fuelSurcharge,
      gst:                    gst,
      remittance_date:        remittanceDate,
    };
  } catch (e) {
    console.error("[SONIC error]", e);
    return null;
  }
}

// ─── M&P ─────────────────────────────────────────────────────────────────────
// Public tracking endpoint — no credentials required
async function fetchFromMandP(cn: string): Promise<CourierData | null> {
  try {
    const res = await fetch(
      `https://tracking.mulphilog.com.pk/api/CNTracking?consignment=${encodeURIComponent(cn)}&id=4`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const entry = json?.[0];
    if (String(entry?.isSuccess) !== "true") return null;
    const details = entry.tracking_Details?.[0];
    if (!details) return null;

    const events: any[] = details.CNTrackingDetail ?? [];
    const lastEvent = events[events.length - 1];

    const amountPaid = Number(details.AmountPaid ?? 0);
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
      fuel_surcharge:         null, // M&P API does not expose this separately
      gst:                    null, // M&P API does not expose this separately
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
    const body = await req.json().catch(() => ({}));
    const trackingNumbers: string[] = (body.tracking_numbers ?? []).filter(Boolean);

    if (!trackingNumbers.length) return json(200, { ok: true, data: {} });

    const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
    const { data: cached } = await supabase
      .from("sonic_cache")
      .select("tracking_number, courier, courier_status, courier_payment_status, shipping_charges, fuel_surcharge, gst, remittance_date")
      .in("tracking_number", trackingNumbers)
      .gte("last_synced_at", cutoff);

    const resultMap = new Map<string, any>(
      (cached ?? []).map((r: any) => [r.tracking_number, r])
    );

    const stale = trackingNumbers.filter(tn => !resultMap.has(tn));
    for (const tn of stale) {
      const courier = detectCourier(tn);
      const fetched = courier === "mandp"
        ? await fetchFromMandP(tn)
        : await fetchFromSonic(tn);

      if (fetched) {
        const row = { tracking_number: tn, courier, ...fetched, last_synced_at: new Date().toISOString() };
        await supabase.from("sonic_cache").upsert(row, { onConflict: "tracking_number" });
        resultMap.set(tn, row);
      }
    }

    const data: Record<string, any> = {};
    for (const tn of trackingNumbers) {
      const e = resultMap.get(tn);
      data[tn] = e ? {
        courier:                e.courier,
        courier_status:         e.courier_status,
        courier_payment_status: e.courier_payment_status,
        shipping_charges:       e.shipping_charges,
        fuel_surcharge:         e.fuel_surcharge,
        gst:                    e.gst,
        remittance_date:        e.remittance_date ?? null,
      } : null;
    }

    return json(200, { ok: true, data });
  } catch (e) {
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
