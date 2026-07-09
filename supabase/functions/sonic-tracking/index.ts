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
  shipping_charges:       number | null; // weight charges (base freight)
  fuel_surcharge:         number | null;
  gst:                    number | null; // actual billed GST from payments endpoint
  cod_amount:             number | null;
  wht:                    number | null; // withholding tax (2%)
  cod_sst:                number | null; // COD sales service tax (2%)
  remittance_date:        string | null;
};

// M&P CN numbers are always 15-digit numeric strings starting with 560
function detectCourier(tn: string): "mandp" | "sonic" {
  return /^560\d{12}$/.test(tn) ? "mandp" : "sonic";
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  // handle formatted strings like "1,680.20"
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return isNaN(n) ? null : n;
}

// ─── SONIC ────────────────────────────────────────────────────────────────────
async function fetchFromSonic(tn: string): Promise<CourierData | null> {
  const headers = { "Authorization": SONIC_API_KEY };
  const enc     = encodeURIComponent(tn);

  try {
    const [trackRes, chargesRes, paymentsRes] = await Promise.all([
      fetch(`https://sonic.pk/api/shipment/track?tracking_number=${enc}&type=0`, { headers, signal: AbortSignal.timeout(10_000) }),
      fetch(`https://sonic.pk/api/shipment/charges?tracking_number=${enc}`,      { headers, signal: AbortSignal.timeout(10_000) }),
      fetch(`https://sonic.pk/api/shipment/payments?tracking_number=${enc}`,     { headers, signal: AbortSignal.timeout(10_000) }),
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

    // /charges endpoint — weight_charges is the base freight (not total_charges which excludes GST)
    const c            = chargesData?.status === 0 ? chargesData.charges : null;
    const weightCharges = toNum(c?.weight_charges);
    const fuelSurcharge = toNum(c?.fuel_surcharge);

    // /payments endpoint — two distinct entry types:
    //   charge entry (amount = 0, type = 3): delivery fee billed to shipper, has actual GST
    //   remittance entry (amount > 0, type = 0): COD collected, has WHT + COD SST
    const payments: any[] = paymentsData?.status === 0 ? (paymentsData.payments ?? []) : [];

    const chargeEntry     = payments.find(p => (toNum(p.amount) ?? 0) === 0);
    const remittanceEntry = payments.find(p => (toNum(p.amount) ?? 0) > 0);

    // Actual billed GST comes from the charge entry in payments (not the /charges estimate)
    const gstActual = chargeEntry
      ? toNum(chargeEntry.gst)
      : toNum(c?.gst); // fall back to /charges estimate if not yet billed

    const paymentStatus: string | null = paymentsData?.status === 0
      ? paymentsData?.current_payment_status ?? null
      : null;

    // COD amount: from remittance entry (actual collected), fall back to booked amount
    const bookedAmount = toNum(details?.order_information?.amount);
    const codAmount    = remittanceEntry ? toNum(remittanceEntry.amount) : bookedAmount;

    // WHT and COD SST: from remittance entry, fall back to top-level payments.charges
    const wht    = toNum(remittanceEntry?.wht)     ?? toNum(paymentsData?.charges?.wht);
    const codSst = toNum(remittanceEntry?.cod_sst) ?? toNum(paymentsData?.charges?.cod_sst);

    // Remittance date: from the COD remittance entry
    let remittanceDate: string | null = null;
    const rawDate: string | null = remittanceEntry?.datetime ?? null;
    if (rawDate) {
      const d = new Date(rawDate);
      remittanceDate = !isNaN(d.getTime()) ? d.toISOString() : rawDate;
    }

    return {
      courier_status:         currentStatus,
      courier_payment_status: paymentStatus,
      shipping_charges:       weightCharges,
      fuel_surcharge:         fuelSurcharge,
      gst:                    gstActual,
      cod_amount:             codAmount,
      wht,
      cod_sst:                codSst,
      remittance_date:        remittanceDate,
    };
  } catch (e) {
    console.error("[SONIC error]", e);
    return null;
  }
}

// ─── M&P ─────────────────────────────────────────────────────────────────────
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
      fuel_surcharge:         null,
      gst:                    null,
      cod_amount:             amountPaid > 0 ? amountPaid : null,
      wht:                    null,
      cod_sst:                null,
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
      .select("tracking_number, courier, courier_status, courier_payment_status, shipping_charges, fuel_surcharge, gst, cod_amount, wht, cod_sst, remittance_date")
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
        cod_amount:             e.cod_amount ?? null,
        wht:                    e.wht ?? null,
        cod_sst:                e.cod_sst ?? null,
        remittance_date:        e.remittance_date ?? null,
      } : null;
    }

    return json(200, { ok: true, data });
  } catch (e) {
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
