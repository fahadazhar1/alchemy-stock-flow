// Daily GA4 sync — pulls sessions/bounceRate/conversions + channel breakdown
// per store from the GA4 Data API and upserts into ga4_daily_metrics /
// ga4_channel_daily. Unlike shopify-sync, GA4's reporting API is already a
// daily aggregate (not a paginated live feed), so a single request per
// store per report is enough — no resumable multi-stage pattern needed.
//
// If a future store has no GA4 property configured yet, just omit it from
// STORE_PROPERTY_MAP — get_ga4_monthly_summary's has_synced flag reflects
// that on the frontend rather than showing a false zero.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GA4_KEY = JSON.parse(Deno.env.get("GA4_SERVICE_ACCOUNT_KEY")!);

// store_id (Supabase) -> GA4 property ID. Resolved 2026-08-07 — see
// reference_ga4_service_account memory for how the UK duplicate was picked.
const STORE_PROPERTY_MAP: Record<string, string> = {
  "21309b04-5b7e-4cfd-9da2-e799bb9cf37b": "447787401", // UK
  "3a9c6e9d-992d-4a1d-beeb-fe8fbb705cc9": "465802032", // PK
  "b7a583c9-0098-44c4-8ad0-f47105facf40": "468173374", // KSA
  "0a87a393-3549-4303-8eca-b3415b615f59": "469529584", // UAE
};

const SYNC_DAYS = 4; // re-pull the last few days each run to catch late-arriving/adjusted GA4 data

function base64url(input: string | Uint8Array) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: GA4_KEY.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;

  const pemBody = GA4_KEY.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const keyData = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64url(new Uint8Array(signature))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`GA4 token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function runReport(token: string, propertyId: string, body: unknown) {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`GA4 runReport failed for ${propertyId}: ${JSON.stringify(data)}`);
  return data;
}

function ga4DateToIso(d: string): string {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const token = await getAccessToken();
  const results: Record<string, string> = {};

  for (const [storeId, propertyId] of Object.entries(STORE_PROPERTY_MAP)) {
    try {
      const daily = await runReport(token, propertyId, {
        dateRanges: [{ startDate: `${SYNC_DAYS}daysAgo`, endDate: "today" }],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "sessions" }, { name: "bounceRate" }, { name: "conversions" }],
      });
      const dailyRows = (daily.rows ?? []).map((r: any) => ({
        store_id: storeId,
        date: ga4DateToIso(r.dimensionValues[0].value),
        sessions: Number(r.metricValues[0].value),
        bounce_rate: Number(r.metricValues[1].value),
        conversions: Number(r.metricValues[2].value),
        updated_at: new Date().toISOString(),
      }));
      if (dailyRows.length > 0) {
        const { error } = await supabase.from("ga4_daily_metrics").upsert(dailyRows, { onConflict: "store_id,date" });
        if (error) throw error;
      }

      const channels = await runReport(token, propertyId, {
        dateRanges: [{ startDate: `${SYNC_DAYS}daysAgo`, endDate: "today" }],
        dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }],
      });
      const channelRows = (channels.rows ?? []).map((r: any) => ({
        store_id: storeId,
        date: ga4DateToIso(r.dimensionValues[0].value),
        channel_group: r.dimensionValues[1].value,
        sessions: Number(r.metricValues[0].value),
        updated_at: new Date().toISOString(),
      }));
      if (channelRows.length > 0) {
        const { error } = await supabase
          .from("ga4_channel_daily")
          .upsert(channelRows, { onConflict: "store_id,date,channel_group" });
        if (error) throw error;
      }

      results[storeId] = `ok: ${dailyRows.length} daily rows, ${channelRows.length} channel rows`;
    } catch (e) {
      results[storeId] = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return new Response(JSON.stringify({ results }), { headers: corsHeaders });
});
