import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SONIC_API_KEY = Deno.env.get("SONIC_API_KEY")!;
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BATCH_SIZE  = 50;
const CONCURRENT  = 5;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
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

    // Target rows that need a cod_amount refresh:
    // 1. cod_amount IS NULL — never fetched
    // 2. cod_amount = 0 — may be stale (SONIC API returned 0 before finalising, or genuinely prepaid)
    //    Gate on last_synced_at to avoid thrashing confirmed prepaid orders
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await supabase
      .from("sonic_cache")
      .select("tracking_number")
      .eq("courier", "sonic")
      .or(`cod_amount.is.null,and(cod_amount.eq.0,last_synced_at.lt.${twoHoursAgo})`)
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

        const [trackRes, paymentsRes] = await Promise.all([
          fetch(`https://sonic.pk/api/shipment/track?tracking_number=${enc}&type=0`,
            { headers, signal: AbortSignal.timeout(10_000) }),
          fetch(`https://sonic.pk/api/shipment/payments?tracking_number=${enc}`,
            { headers, signal: AbortSignal.timeout(10_000) }),
        ]);

        const [trackData, paymentsData] = await Promise.all([
          trackRes.ok    ? trackRes.json()    : null,
          paymentsRes.ok ? paymentsRes.json() : null,
        ]);

        if (!trackData || trackData.status !== 0) { failed++; return; }

        // payments[0].amount = actual COD collected/remitted (matches SONIC portal)
        // order_information.amount = COD booked at shipment creation
        const remittedAmount = paymentsData?.status === 0
          ? toNum(paymentsData?.payments?.[0]?.amount)
          : null;
        const bookedAmount = toNum(trackData?.details?.order_information?.amount);
        const codAmount    = remittedAmount ?? bookedAmount;

        if (codAmount === null) { failed++; return; }

        const { error: updateErr } = await supabase
          .from("sonic_cache")
          .update({ cod_amount: codAmount, last_synced_at: new Date().toISOString() })
          .eq("tracking_number", tn);

        if (updateErr) { failed++; } else { updated++; }
      } catch {
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
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
