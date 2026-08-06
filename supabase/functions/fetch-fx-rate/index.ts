// Auto-fetches and locks the GBP->SAR and PKR->SAR rate for a given month, once.
// SAR and AED are fixed USD pegs and never need this — only GBP/PKR float.
//
// "Once it has set, it won't be changed" (explicit user instruction): this function
// checks for an existing row first and never overwrites one. For the current
// (in-progress) month, "the month's rate" is necessarily approximated by today's live
// rate the first time anyone opens that month's P&L — there's no way to average days
// that haven't happened yet. For a past month with no rate on record yet, this is the
// same live-rate fallback (best available without a paid historical-FX API) — same
// approximation already used for ad-spend FX conversion in the monthly report scripts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FLOATING_CURRENCIES = ["GBP", "PKR"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { monthKey } = await req.json(); // "yyyy-MM"
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
      return new Response(JSON.stringify({ error: "monthKey must be yyyy-MM" }), { status: 400, headers: corsHeaders });
    }
    const monthDate = `${monthKey}-01`;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: existing, error: existingErr } = await supabase
      .from("fx_rates")
      .select("currency, rate_to_sar")
      .eq("month", monthDate);
    if (existingErr) throw existingErr;

    const have = new Set((existing ?? []).map((r: any) => r.currency));
    const missing = FLOATING_CURRENCIES.filter((c) => !have.has(c));

    if (missing.length === 0) {
      // Already set — return as-is, never re-fetch or overwrite.
      const map: Record<string, number> = {};
      for (const r of existing ?? []) map[(r as any).currency] = Number((r as any).rate_to_sar);
      return new Response(JSON.stringify({ rates: map, fetched: false }), { headers: corsHeaders });
    }

    const res = await fetch("https://open.er-api.com/v6/latest/SAR");
    const liveData = await res.json();
    if (liveData.result !== "success") throw new Error("FX rate provider returned an error");

    // liveData.rates[X] = how many X per 1 SAR, so SAR-per-X (what we store) is the inverse.
    const rows = missing.map((currency) => ({
      currency,
      month: monthDate,
      rate_to_sar: 1 / liveData.rates[currency],
    }));

    // Insert only — if another request raced us and already inserted this month/currency,
    // the (currency, month) primary key rejects the duplicate rather than overwriting it.
    const { error: insertErr } = await supabase.from("fx_rates").insert(rows).select();
    if (insertErr && insertErr.code !== "23505") throw insertErr; // 23505 = unique_violation, safe to ignore

    const { data: finalRates, error: finalErr } = await supabase
      .from("fx_rates")
      .select("currency, rate_to_sar")
      .eq("month", monthDate);
    if (finalErr) throw finalErr;

    const map: Record<string, number> = {};
    for (const r of finalRates ?? []) map[(r as any).currency] = Number((r as any).rate_to_sar);
    return new Response(JSON.stringify({ rates: map, fetched: true }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: corsHeaders });
  }
});
