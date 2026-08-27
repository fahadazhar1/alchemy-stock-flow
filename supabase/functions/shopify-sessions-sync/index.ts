// Daily sync of Shopify's own first-party session/bounce-rate analytics
// (ShopifyQL `FROM sessions`) into shopify_sessions_daily — replaces GA4 as
// the KPI Tracker's bounce-rate source. GA4's bounceRate was found corrupted
// by a broken Web Pixel sandbox tag (near-100% bounce site-wide, traced to
// phantom sessions from a /web-pixels@.../sandbox/ URL showing as the
// "landing page"). Shopify's native tracking is unaffected by that tag.
//
// Re-pulls the last few days each run (SYNC_DAYS) since ShopifyQL's own
// numbers can settle/adjust slightly after the fact, same reasoning as
// ga4-sync's SYNC_DAYS.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SYNC_DAYS = 5;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function runShopifyQL(domain: string, token: string, query: string) {
  const res = await fetch(`https://${domain}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `{ shopifyqlQuery(query: ${JSON.stringify(query)}) { parseErrors tableData { columns { name } rows } } }`,
    }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) throw new Error(`ShopifyQL failed for ${domain}: ${JSON.stringify(data.errors ?? data)}`);
  const result = data.data?.shopifyqlQuery;
  if (result?.parseErrors?.length) throw new Error(`ShopifyQL parse error for ${domain}: ${result.parseErrors.join("; ")}`);
  return result?.tableData?.rows ?? [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const results: Record<string, unknown> = {};

  try {
    let days = SYNC_DAYS;
    try {
      const body = await req.json();
      if (body?.days) days = Number(body.days);
    } catch { /* no body — normal cron call, use default */ }

    const { data: connections, error: connErr } = await supabase
      .from("shopify_connections")
      .select("store_id, shop_domain, access_token")
      .eq("is_active", true);
    if (connErr) throw connErr;

    const since = isoDate(new Date(Date.now() - days * 86_400_000));
    const until = isoDate(new Date());

    for (const conn of connections ?? []) {
      try {
        const rows = await runShopifyQL(
          conn.shop_domain,
          conn.access_token,
          `FROM sessions SHOW bounce_rate, bounces, sessions, conversion_rate TIMESERIES day SINCE ${since} UNTIL ${until}`
        );
        const upsertRows = rows.map((r: any) => ({
          store_id: conn.store_id,
          date: r.day,
          sessions: Math.round(Number(r.sessions ?? 0)),
          bounces: Math.round(Number(r.bounces ?? 0)),
          bounce_rate: Number(r.bounce_rate ?? 0),
          conversion_rate: Number(r.conversion_rate ?? 0),
          updated_at: new Date().toISOString(),
        }));
        if (upsertRows.length > 0) {
          const { error: upsertErr } = await supabase
            .from("shopify_sessions_daily")
            .upsert(upsertRows, { onConflict: "store_id,date" });
          if (upsertErr) throw upsertErr;
        }
        results[conn.shop_domain] = { ok: true, days: upsertRows.length };
      } catch (e) {
        results[conn.shop_domain] = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: corsHeaders });
  }
});
