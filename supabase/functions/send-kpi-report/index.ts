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

// Ported from src/hooks/useChannelPerformance.ts normalizeKey() — must stay
// in sync so a channel filter selected on the page maps to the same rows
// here as it does client-side.
function normalizeKey(source: string | null): string {
  const k = (source ?? "").toLowerCase().trim();
  if (k === "" || k === "null") return "admin";
  if (k === "web" || k.includes("online_store") || k.includes("online store")) return "web";
  if (k === "pos" || k.includes("point_of_sale") || k.includes("point of sale")) return "pos";
  if (k === "android" || k === "iphone" || k === "shop") return "shop";
  if (k.includes("amazon")) return "amazon";
  if (k.includes("ebay")) return "ebay";
  if (k.includes("google")) return "google";
  if (k.includes("facebook") || k === "fb") return "facebook";
  if (k.includes("instagram") || k === "ig") return "instagram";
  if (k.includes("tiktok") || k.includes("tik_tok") || k.includes("tik tok")) return "tiktok";
  if (k.includes("etsy")) return "etsy";
  if (k.includes("walmart")) return "walmart";
  if (k.includes("wholesale")) return "wholesale";
  if (k.includes("subscription")) return "subscription";
  if (k.includes("draft")) return "shopify_draft_orders";
  return "unknown";
}

// Sums a set of get_store_period_channel_sales rows for one store+bucket,
// applying the same channel filter and shipping-exclusion the page's Sales
// Pulse cards use (useStoreSalesPulse) — without this the report always
// summed every channel with shipping included, ignoring the page's filters.
function sumSalesRows(
  rows: any[],
  storeId: string,
  bucket: "cur" | "prev",
  channelFilter: string[],
  excludeShipping: boolean,
): { revenue: number; orders: number } {
  let revenue = 0;
  let orders = 0;
  for (const r of rows) {
    if (r.store_id !== storeId || r.bucket !== bucket) continue;
    if (channelFilter.length > 0 && !channelFilter.includes(normalizeKey(r.source_name))) continue;
    let netRevenue = Number(r.revenue ?? 0);
    if (excludeShipping) netRevenue -= Number(r.shipping_revenue ?? 0);
    revenue += netRevenue;
    orders += Number(r.orders ?? 0);
  }
  return { revenue, orders };
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
    // date: "YYYY-MM-DD" selected in the page's filter bar. includeMtd: page's
    // "MTD in ClickUp" toggle. channelFilter/excludeShipping: same Sales Pulse
    // filters shown on the page — must be applied here too, or the report's
    // Sales figure silently diverges from what's on screen.
    const { date, includeMtd = true, channelFilter = [], excludeShipping = false } = await req.json();
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

      // Sales — the selected day + MTD, filtered to whatever channel(s) and
      // shipping-inclusion the page's Sales Pulse filter bar has selected.
      const { data: salesRows } = await supabase.rpc("get_store_period_channel_sales", {
        p_start_iso: today.startISO, p_end_iso: today.endISO,
        p_prev_start_iso: mtdStart, p_prev_end_iso: today.endISO,
      });
      const { revenue: dayRevenue, orders: dayOrders } = sumSalesRows(salesRows ?? [], store.id, "cur", channelFilter, excludeShipping);
      const { revenue: mtdRevenue, orders: mtdOrders } = sumSalesRows(salesRows ?? [], store.id, "prev", channelFilter, excludeShipping);

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
      msg += includeMtd
        ? `| Metric | Owner | Target | Actual | MTD | Reviewed |\n|---|---|---|---|---|---|\n`
        : `| Metric | Owner | Target | Actual | Reviewed |\n|---|---|---|---|---|\n`;
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
        msg += includeMtd
          ? `| ${c.metric_label} | ${c.owner || "—"} | ${c.target || "—"} | ${actual} | ${mtd} | Daily |\n`
          : `| ${c.metric_label} | ${c.owner || "—"} | ${c.target || "—"} | ${actual} | Daily |\n`;
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
