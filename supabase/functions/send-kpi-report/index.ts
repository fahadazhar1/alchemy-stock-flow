// Sends the Daily KPI Tracker ("ClickUp Reports" page) as one formatted ClickUp
// DM, one message per store, sent sequentially with a delay (ClickUp's chat API
// rate-limits back-to-back sends — see project_clickup_daily_report memory).
//
// `date` is whatever date is selected in the frontend's date filter bar (the
// page passes its own gaEnd, not necessarily literal "today") — the report's
// title and every "Actual" figure are for that single day; "MTD" is always
// month-start through that same date. Sales / Organic traffic / Bounce
// rate+CRO are computed live here (same source tables the Sales Pulse / P&L
// GA4 section already use) — never read back from daily_kpi_entries, so
// there's nothing that can drift out of sync. Every other metric is whatever
// the team typed into daily_kpi_entries for the given date (Actual) or summed
// across the month (MTD).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLICKUP_TOKEN = Deno.env.get("CLICKUP_API_TOKEN")!;
const CLICKUP_CHANNEL_ID = "8cne4vw-289955"; // Fahad's ClickUp DM channel

const STORE_TZ_OFFSET_HOURS: Record<string, number> = {
  "21309b04-5b7e-4cfd-9da2-e799bb9cf37b": 5, // UK  (Asia/Karachi, per stores.timezone)
  "3a9c6e9d-992d-4a1d-beeb-fe8fbb705cc9": 5, // PK  (Asia/Karachi)
  "b7a583c9-0098-44c4-8ad0-f47105facf40": 3, // KSA (Asia/Riyadh)
  "0a87a393-3549-4303-8eca-b3415b615f59": 4, // UAE (Asia/Dubai)
};

function dayBoundsUTC(dateStr: string, offsetHours: number) {
  // dateStr = "YYYY-MM-DD" in the store's own local calendar day.
  const start = new Date(`${dateStr}T00:00:00Z`);
  start.setUTCHours(start.getUTCHours() - offsetHours);
  const end = new Date(start.getTime() + 86_400_000 - 1);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

function monthStartDateStr(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

function monthStartUTC(dateStr: string, offsetHours: number) {
  return dayBoundsUTC(monthStartDateStr(dateStr), offsetHours).startISO;
}

function fmtMoney(sym: string, n: number): string {
  return `${sym}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function aggregateBounce(rows: any[]): string {
  if (rows.length === 0) return "No data yet";
  const sessions = rows.reduce((s, r) => s + Number(r.sessions), 0);
  const bounces = rows.reduce((s, r) => s + Number(r.bounces), 0);
  const conversions = rows.reduce((s, r) => s + Number(r.conversions), 0);
  if (sessions === 0) return "No data yet";
  return `${((bounces / sessions) * 100).toFixed(1)}% bounce · ${((conversions / sessions) * 100).toFixed(2)}% CRO`;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { date } = await req.json(); // "YYYY-MM-DD" — the date selected in the page's filter bar
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(JSON.stringify({ error: "date must be YYYY-MM-DD" }), { status: 400, headers: corsHeaders });
    }
    const mtdStartDate = monthStartDateStr(date);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: stores, error: storesErr } = await supabase
      .from("stores").select("id, store_name, store_code, currency_symbol").eq("is_active", true);
    if (storesErr) throw storesErr;

    const { data: configRows, error: configErr } = await supabase
      .from("kpi_metric_config").select("*").order("sort_order");
    if (configErr) throw configErr;

    const { data: entryRows, error: entryErr } = await supabase
      .from("daily_kpi_entries").select("*").eq("entry_date", date);
    if (entryErr) throw entryErr;

    const { data: entryMtdRows, error: entryMtdErr } = await supabase
      .from("daily_kpi_entries").select("*").gte("entry_date", mtdStartDate).lte("entry_date", date);
    if (entryMtdErr) throw entryMtdErr;

    const { data: sessionMtdRows, error: sessionMtdErr } = await supabase
      .from("shopify_sessions_daily").select("store_id, sessions, bounces, conversions")
      .gte("date", mtdStartDate).lte("date", date);
    if (sessionMtdErr) throw sessionMtdErr;

    const { data: channelMtdRows } = await supabase.rpc("get_ga4_channel_summary", {
      p_start_date: mtdStartDate, p_end_date: date,
    });

    const results: Record<string, unknown> = {};

    for (const store of stores ?? []) {
      const offset = STORE_TZ_OFFSET_HOURS[store.id] ?? 5;
      const today = dayBoundsUTC(date, offset);
      const mtdStart = monthStartUTC(date, offset);

      // Sales — the selected day + MTD, all channels, shipping included
      // (matches the Sales Pulse card's default toggle state: "Exclude
      // shipping" off).
      const { data: salesRows } = await supabase.rpc("get_store_period_channel_sales", {
        p_start_iso: today.startISO, p_end_iso: today.endISO,
        p_prev_start_iso: mtdStart, p_prev_end_iso: today.endISO,
      });
      let dayRevenue = 0, dayOrders = 0, mtdRevenue = 0, mtdOrders = 0;
      for (const r of salesRows ?? []) {
        if (r.store_id !== store.id) continue;
        if (r.bucket === "cur") { dayRevenue += Number(r.revenue); dayOrders += Number(r.orders); }
        if (r.bucket === "prev") { mtdRevenue += Number(r.revenue); mtdOrders += Number(r.orders); }
      }

      // Organic traffic — selected day, GA4 "Organic Search" channel.
      const { data: channelRows } = await supabase.rpc("get_ga4_channel_summary", {
        p_start_date: date, p_end_date: date,
      });
      const organicDay = (channelRows ?? [])
        .filter((r: any) => r.store_id === store.id && r.channel_group === "Organic Search")
        .reduce((s: number, r: any) => s + Number(r.sessions), 0);
      const organicMtd = (channelMtdRows ?? [])
        .filter((r: any) => r.store_id === store.id && r.channel_group === "Organic Search")
        .reduce((s: number, r: any) => s + Number(r.sessions), 0);

      // Bounce rate + CRO — Shopify's own session analytics (ShopifyQL,
      // synced via shopify-sessions-sync). NOT GA4 — GA4's bounceRate was
      // found corrupted by a broken Web Pixel sandbox tag (near-100% bounce
      // site-wide from 2026-08-25), traced via landing-page breakdown to
      // phantom /web-pixels@.../sandbox/ sessions. Shopify's native tracking
      // is unaffected by that tag issue.
      const { data: sessionRow } = await supabase
        .from("shopify_sessions_daily")
        .select("sessions, bounces, conversions")
        .eq("store_id", store.id).eq("date", date).maybeSingle();
      const bounceDay = sessionRow ? aggregateBounce([sessionRow]) : "No data yet";
      const bounceMtd = aggregateBounce((sessionMtdRows ?? []).filter((r: any) => r.store_id === store.id));

      const sym = store.currency_symbol ?? "";
      const actualValues: Record<string, string> = {
        sales: `${fmtMoney(sym, dayRevenue)} (${dayOrders})`,
        organic_traffic: `${organicDay} sessions`,
        bounce_cro: bounceDay,
      };
      const mtdValues: Record<string, string> = {
        sales: `${fmtMoney(sym, mtdRevenue)} (${mtdOrders})`,
        organic_traffic: `${organicMtd} sessions`,
        bounce_cro: bounceMtd,
      };

      const storeConfig = (configRows ?? []).filter((c: any) => c.store_id === store.id);
      const storeEntries = new Map(
        (entryRows ?? []).filter((e: any) => e.store_id === store.id).map((e: any) => [e.metric_key, e.value_text])
      );
      const storeMtdEntries = (entryMtdRows ?? []).filter((e: any) => e.store_id === store.id);

      let msg = `## ${store.store_name} — Daily KPI Report (${date})\n\n`;
      msg += `| Metric | Owner | Target | Actual | MTD | Reviewed |\n`;
      msg += `|---|---|---|---|---|---|\n`;
      for (const c of storeConfig) {
        let actual: string;
        let mtd: string;
        if (c.is_auto) {
          actual = actualValues[c.metric_key] ?? "—";
          mtd = mtdValues[c.metric_key] ?? "—";
        } else {
          actual = storeEntries.get(c.metric_key) || "—";
          const nums = storeMtdEntries
            .filter((e: any) => e.metric_key === c.metric_key)
            .map((e: any) => parseFloat(e.value_text))
            .filter((n: number) => !Number.isNaN(n));
          mtd = nums.length > 0 ? nums.reduce((s: number, n: number) => s + n, 0).toLocaleString() : "—";
        }
        msg += `| ${c.metric_label} | ${c.owner || "—"} | ${c.target || "—"} | ${actual} | ${mtd} | Daily |\n`;
      }

      const res = await fetch(`https://api.clickup.com/api/v3/workspaces/9015071612/chat/channels/${CLICKUP_CHANNEL_ID}/messages`, {
        method: "POST",
        headers: { Authorization: CLICKUP_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "message", content: msg, content_format: "text/md" }),
      });
      results[store.store_code] = { sent: res.status === 201, status: res.status };

      await sleep(16_000); // ClickUp chat API rate limit — see memory
    }

    return new Response(JSON.stringify({ ok: true, results }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: corsHeaders });
  }
});
