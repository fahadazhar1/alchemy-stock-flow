import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SONIC_API_KEY = Deno.env.get("SONIC_API_KEY")!;
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BATCH_SIZE = 50;
const CONCURRENT = 5;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v);
  return isNaN(n) ? null : n;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Target SONIC rows that need a full financial refresh:
    //   1. cod_amount IS NULL  — never fetched
    //   2. cod_amount = 0 AND stale (might be pre-payment hold; avoid thrashing confirmed prepaid)
    //   3. wht IS NULL        — charges were stored before wht/cod_sst columns were added
    //   4. gst IS NULL        — same as above; pre-migration rows lack actual billed GST
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await supabase
      .from("sonic_cache")
      .select("tracking_number")
      .eq("courier", "sonic")
      .or([
        "cod_amount.is.null",
        `and(cod_amount.eq.0,last_synced_at.lt.${twoHoursAgo})`,
        "wht.is.null",
        "gst.is.null",
      ].join(","))
      .limit(BATCH_SIZE);

    if (error) throw error;

    const trackingNumbers: string[] = (rows ?? []).map((r: any) => r.tracking_number);

    if (!trackingNumbers.length) {
      return json(200, { ok: true, updated: 0, failed: 0, message: "Nothing to backfill" });
    }

    let updated = 0;
    let failed  = 0;

    async function backfillOne(tn: string) {
      try {
        const headers = { Authorization: SONIC_API_KEY };
        const enc     = encodeURIComponent(tn);

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

        if (!trackData || trackData.status !== 0) { failed++; return; }

        // /charges: weight_charges is the base freight line item
        const c             = chargesData?.status === 0 ? chargesData.charges : null;
        const weightCharges = toNum(c?.weight_charges);
        const fuelSurcharge = toNum(c?.fuel_surcharge);

        // /payments: find correct entries by amount sign
        // charge entry (amount ≤ 0): delivery fee billed to shipper, holds actual billed GST
        // remittance entry (amount > 0): COD collected, holds WHT + COD SST
        //
        // PREVIOUS BUG: code read payments[0] which is always the charge entry (amount=0),
        // causing cod_amount to always be set to 0.
        const payments: any[] = paymentsData?.status === 0 ? (paymentsData.payments ?? []) : [];
        const chargeEntry     = payments.find((p: any) => (toNum(p.amount) ?? 0) <= 0);
        const remittanceEntry = payments.find((p: any) => (toNum(p.amount) ?? 0) > 0);

        const gstActual = chargeEntry
          ? toNum(chargeEntry.gst)
          : toNum(c?.gst);

        const bookedAmount = toNum(trackData?.details?.order_information?.amount);
        const codAmount    = remittanceEntry ? toNum(remittanceEntry.amount) : bookedAmount;

        const wht    = toNum(remittanceEntry?.wht)     ?? toNum(paymentsData?.charges?.wht);
        const codSst = toNum(remittanceEntry?.cod_sst) ?? toNum(paymentsData?.charges?.cod_sst);

        let remittanceDate: string | null = null;
        const rawDate: string | null = remittanceEntry?.datetime ?? null;
        if (rawDate) {
          const d = new Date(rawDate);
          remittanceDate = !isNaN(d.getTime()) ? d.toISOString() : rawDate;
        }

        const paymentStatus: string | null = paymentsData?.status === 0
          ? paymentsData?.current_payment_status ?? null
          : null;

        // Full patch: update all financial fields, not just cod_amount
        const patch: Record<string, unknown> = {
          last_synced_at: new Date().toISOString(),
        };
        if (codAmount    !== null) patch.cod_amount             = codAmount;
        if (wht          !== null) patch.wht                    = wht;
        if (codSst       !== null) patch.cod_sst                = codSst;
        if (gstActual    !== null) patch.gst                    = gstActual;
        if (weightCharges !== null) patch.shipping_charges      = weightCharges;
        if (fuelSurcharge !== null) patch.fuel_surcharge        = fuelSurcharge;
        if (remittanceDate !== null) patch.remittance_date      = remittanceDate;
        if (paymentStatus !== null) patch.courier_payment_status = paymentStatus;

        // Compute internally_calculated_net
        if (codAmount !== null) {
          patch.internally_calculated_net =
            codAmount
            - (wht ?? 0)
            - (codSst ?? 0)
            - (weightCharges ?? 0)
            - (fuelSurcharge ?? 0)
            - (gstActual ?? 0);
        }

        const { error: updateErr } = await supabase
          .from("sonic_cache")
          .update(patch)
          .eq("tracking_number", tn);

        if (updateErr) {
          console.error(`[backfill] update error for ${tn}:`, updateErr.message);
          failed++;
        } else {
          updated++;
        }
      } catch (e) {
        console.error(`[backfill] error for ${tn}:`, e instanceof Error ? e.message : e);
        failed++;
      }
    }

    for (let i = 0; i < trackingNumbers.length; i += CONCURRENT) {
      await Promise.all(trackingNumbers.slice(i, i + CONCURRENT).map(backfillOne));
    }

    return json(200, {
      ok: true,
      updated,
      failed,
      total: trackingNumbers.length,
      remaining: trackingNumbers.length === BATCH_SIZE ? "possibly more — call again" : "done",
    });
  } catch (e) {
    console.error("[backfill] fatal error:", e instanceof Error ? e.message : e);
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
