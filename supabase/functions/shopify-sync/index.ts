// Shopify sync — resumable, multi-stage, runs in background to avoid 150s edge timeout
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STAGES = ["products", "collections", "orders", "inventory"] as const;
type Stage = typeof STAGES[number];
const INVOKE_URL = `${SUPABASE_URL}/functions/v1/shopify-sync`;

function normalizeDomain(d: string) {
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

async function shopifyFetch(domain: string, token: string, path: string): Promise<Response> {
  const url = `https://${domain}/admin/api/2024-01${path}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch(url, {
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.status === 429) {
        const retry = Number(res.headers.get("Retry-After") ?? "2");
        await new Promise((r) => setTimeout(r, retry * 1000 * (attempt + 1)));
        continue;
      }
      if (res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      if (attempt === 5) throw e;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw new Error("Shopify fetch retries exhausted");
}

async function shopifyMutate(domain: string, token: string, method: "POST" | "PUT", path: string, requestBody: unknown): Promise<Response> {
  const url = `https://${domain}/admin/api/2024-01${path}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch(url, {
        method,
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.status === 429) {
        const retry = Number(res.headers.get("Retry-After") ?? "2");
        await new Promise((r) => setTimeout(r, retry * 1000 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw new Error("Shopify mutate retries exhausted");
}

function parseNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const m = linkHeader.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/);
  return m ? m[1] : null;
}

async function testCredentials(domain: string, token: string) {
  const res = await shopifyFetch(domain, token, "/shop.json");
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, status: res.status, error: text.slice(0, 300) };
  }
  const data = await res.json();
  return { ok: true, shop: data.shop };
}

// ------------ Sync log helpers ------------
async function createOrResumeLog(supabase: any, connectionId: string, storeId: string | null) {
  // Resume an in-progress log first
  const { data: existing } = await supabase
    .from("shopify_sync_logs")
    .select("*")
    .eq("connection_id", connectionId)
    .eq("status", "in_progress")
    .order("sync_time", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing;

  // Resume from the last failed log so we don't restart from scratch
  const { data: failed } = await supabase
    .from("shopify_sync_logs")
    .select("*")
    .eq("connection_id", connectionId)
    .eq("status", "failed")
    .not("current_stage", "is", null)
    .order("sync_time", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (failed) {
    const { data: resumed } = await supabase
      .from("shopify_sync_logs")
      .update({ status: "in_progress", error_message: null, metadata: { heartbeat_at: new Date().toISOString() } })
      .eq("id", failed.id)
      .select("*")
      .single();
    return resumed;
  }

  // No resumable log — start fresh
  const { data: created } = await supabase.from("shopify_sync_logs").insert({
    connection_id: connectionId,
    store_id: storeId,
    status: "in_progress",
    records_synced: 0,
    current_stage: "products",
    current_page: 0,
    cursor: null,
  }).select("*").single();
  return created;
}

async function updateLog(supabase: any, logId: string, patch: Record<string, unknown>) {
  await supabase.from("shopify_sync_logs").update({
    ...patch,
    metadata: { heartbeat_at: new Date().toISOString() },
  }).eq("id", logId);
}

// ------------ Self-invoke helper (fixed: awaited with retry) ------------
async function triggerContinue(connectionId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(INVOKE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_ROLE}`,
        },
        body: JSON.stringify({ action: "continue_sync", connection_id: connectionId }),
      });
      if (res.ok) return;
      console.warn(`self-invoke attempt ${attempt + 1} got status ${res.status}`);
    } catch (e) {
      console.error(`self-invoke attempt ${attempt + 1} failed:`, e);
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  console.error("self-invoke failed after 3 attempts — cron will rescue");
}

// ------------ Stage handlers ------------

async function syncProducts(supabase: any, conn: any, log: any, totalRef: { n: number }, syncSince: string | null): Promise<boolean> {
  const domain = normalizeDomain(conn.shop_domain);
  const pageInfo: string | null = log.current_stage === "products" ? log.cursor : null;
  const page: number = log.current_stage === "products" ? (log.current_page ?? 0) : 0;

  const path = pageInfo
    ? `/products.json?limit=50&page_info=${encodeURIComponent(pageInfo)}`
    : syncSince
      ? `/products.json?limit=50&updated_at_min=${encodeURIComponent(syncSince)}`
      : `/products.json?limit=50`;
  const res = await shopifyFetch(domain, conn.access_token, path);
  if (!res.ok) throw new Error(`products [${res.status}]: ${(await res.text()).slice(0, 200)}`);

  const json = await res.json();
  const products = json.products ?? [];

  for (const p of products) {
    const productSku = p.variants?.[0]?.sku || `shopify-${p.id}`;
    const productRow = {
      name: p.title,
      sku: productSku,
      slug: p.handle,
      product_type: p.product_type || null,
      status: p.status || "active",
      shopify_product_id: String(p.id),
      store_id: conn.store_id,
    };
    const { data: existing } = await supabase
      .from("products").select("id").eq("shopify_product_id", String(p.id)).maybeSingle();

    let productId: string;
    if (existing?.id) {
      await supabase.from("products").update(productRow).eq("id", existing.id);
      productId = existing.id;
    } else {
      const { data: ins, error } = await supabase.from("products").insert(productRow).select("id").single();
      if (error) continue;
      productId = ins.id;
    }

    for (const v of p.variants ?? []) {
      const variantRow = {
        product_id: productId,
        variant_sku: v.sku || `shopify-v-${v.id}`,
        size: v.option1 || v.title || "Default",
        price: Number(v.price ?? 0),
        compare_at_price: v.compare_at_price ? Number(v.compare_at_price) : null,
        inventory_quantity: Number(v.inventory_quantity ?? 0),
        shopify_variant_id: String(v.id),
        shopify_inventory_item_id: v.inventory_item_id ? String(v.inventory_item_id) : null,
        store_id: conn.store_id,
      };
      const { data: existV } = await supabase
        .from("variants").select("id").eq("shopify_variant_id", String(v.id)).maybeSingle();
      if (existV?.id) await supabase.from("variants").update(variantRow).eq("id", existV.id);
      else await supabase.from("variants").insert(variantRow);
      totalRef.n++;
    }

    const tags: string[] = (p.tags ? String(p.tags).split(",").map((t: string) => t.trim()).filter(Boolean) : []);
    for (const tagName of tags) {
      const { data: tag } = await supabase.from("tags").upsert({ name: tagName }, { onConflict: "name" }).select("id").single();
      if (tag?.id) {
        await supabase.from("product_tags").upsert({ product_id: productId, tag_id: tag.id }, { onConflict: "product_id,tag_id" });
      }
    }
  }

  const link = res.headers.get("Link") ?? res.headers.get("link");
  const nextPageInfo = parseNextPageInfo(link);

  await updateLog(supabase, log.id, {
    current_stage: "products",
    current_page: page + 1,
    cursor: nextPageInfo,
    records_synced: totalRef.n,
  });

  return nextPageInfo !== null;
}

// FIXED: uses /collects.json bulk endpoint — no nested per-collection API calls
async function syncCollections(supabase: any, conn: any, log: any, totalRef: { n: number }): Promise<boolean> {
  const domain = normalizeDomain(conn.shop_domain);

  // Phase 1: sync collection metadata (custom + smart), one page per invocation
  // Cursor format: "meta:custom:PAGE_INFO", "meta:smart:PAGE_INFO", "collects:PAGE_INFO", or null
  const savedCursor: string | null = log.cursor ?? null;

  // --- Phase 1a: custom_collections metadata ---
  if (!savedCursor || savedCursor.startsWith("meta:custom:")) {
    const pageInfo = savedCursor?.startsWith("meta:custom:") ? savedCursor.slice("meta:custom:".length) : null;
    const path = pageInfo
      ? `/custom_collections.json?limit=50&page_info=${encodeURIComponent(pageInfo)}`
      : `/custom_collections.json?limit=50`;
    const res = await shopifyFetch(domain, conn.access_token, path);
    if (res.ok) {
      const json = await res.json();
      for (const c of json.custom_collections ?? []) {
        await upsertCollection(supabase, c);
        totalRef.n++;
      }
      const link = res.headers.get("Link") ?? res.headers.get("link");
      const next = parseNextPageInfo(link);
      if (next) {
        await updateLog(supabase, log.id, { current_stage: "collections", cursor: `meta:custom:${next}`, records_synced: totalRef.n });
        return true;
      }
    }
    // custom done or failed — move to smart
    await updateLog(supabase, log.id, { current_stage: "collections", cursor: "meta:smart:", records_synced: totalRef.n });
    return true;
  }

  // --- Phase 1b: smart_collections metadata ---
  if (savedCursor.startsWith("meta:smart:")) {
    const pageInfo = savedCursor.slice("meta:smart:".length) || null;
    const path = pageInfo
      ? `/smart_collections.json?limit=50&page_info=${encodeURIComponent(pageInfo)}`
      : `/smart_collections.json?limit=50`;
    const res = await shopifyFetch(domain, conn.access_token, path);
    if (res.ok) {
      const json = await res.json();
      for (const c of json.smart_collections ?? []) {
        await upsertCollection(supabase, c);
        totalRef.n++;
      }
      const link = res.headers.get("Link") ?? res.headers.get("link");
      const next = parseNextPageInfo(link);
      if (next) {
        await updateLog(supabase, log.id, { current_stage: "collections", cursor: `meta:smart:${next}`, records_synced: totalRef.n });
        return true;
      }
    }
    // smart done — move to collects phase
    await updateLog(supabase, log.id, { current_stage: "collections", cursor: "collects:", records_synced: totalRef.n });
    return true;
  }

  // --- Phase 2: bulk collects (product↔collection links) via /collects.json ---
  if (savedCursor.startsWith("collects:")) {
    const pageInfo = savedCursor.slice("collects:".length) || null;
    const path = pageInfo
      ? `/collects.json?limit=250&page_info=${encodeURIComponent(pageInfo)}`
      : `/collects.json?limit=250`;
    const res = await shopifyFetch(domain, conn.access_token, path);
    if (res.ok) {
      const json = await res.json();
      for (const collect of json.collects ?? []) {
        const { data: prod } = await supabase.from("products").select("id")
          .eq("shopify_product_id", String(collect.product_id)).maybeSingle();
        const { data: coll } = await supabase.from("collections").select("id")
          .eq("shopify_collection_id", String(collect.collection_id)).maybeSingle();
        if (prod?.id && coll?.id) {
          await supabase.from("product_collections")
            .upsert({ product_id: prod.id, collection_id: coll.id }, { onConflict: "product_id,collection_id" });
          totalRef.n++;
        }
      }
      const link = res.headers.get("Link") ?? res.headers.get("link");
      const next = parseNextPageInfo(link);
      if (next) {
        await updateLog(supabase, log.id, { current_stage: "collections", cursor: `collects:${next}`, records_synced: totalRef.n });
        return true;
      }
    }
    // collects done
    await updateLog(supabase, log.id, { current_stage: "collections", cursor: null, records_synced: totalRef.n });
    return false;
  }

  return false;
}

async function upsertCollection(supabase: any, c: any) {
  const { data: existing } = await supabase
    .from("collections").select("id").eq("shopify_collection_id", String(c.id)).maybeSingle();
  if (existing?.id) {
    await supabase.from("collections").update({ name: c.title }).eq("id", existing.id);
  } else {
    await supabase.from("collections").insert({ name: c.title, shopify_collection_id: String(c.id) });
  }
}

// FIXED: single page per invocation (was: all pages in one invocation)
async function syncOrders(supabase: any, conn: any, log: any, totalRef: { n: number }, syncSince: string | null): Promise<boolean> {
  const domain = normalizeDomain(conn.shop_domain);
  const pageInfo: string | null = log.current_stage === "orders" ? log.cursor : null;
  const page: number = log.current_stage === "orders" ? (log.current_page ?? 0) : 0;

  const path = pageInfo
    ? `/orders.json?limit=50&page_info=${encodeURIComponent(pageInfo)}`
    : syncSince
      ? `/orders.json?limit=50&status=any&updated_at_min=${encodeURIComponent(syncSince)}`
      : `/orders.json?limit=50&status=any`;
  const res = await shopifyFetch(domain, conn.access_token, path);
  if (!res.ok) throw new Error(`orders [${res.status}]: ${(await res.text()).slice(0, 200)}`);

  const json = await res.json();
  const orders = json.orders ?? [];

  for (const o of orders) {
    const orderRow = {
      order_number: String(o.name || o.order_number || o.id),
      status: o.financial_status || o.fulfillment_status || "unknown",
      shopify_order_id: String(o.id),
      store_id: conn.store_id,
    };
    const { data: existing } = await supabase
      .from("orders").select("id").eq("shopify_order_id", String(o.id)).maybeSingle();
    let orderId: string;
    if (existing?.id) {
      await supabase.from("orders").update(orderRow).eq("id", existing.id);
      orderId = existing.id;
      await supabase.from("order_items").delete().eq("order_id", orderId);
    } else {
      const { data: ins, error } = await supabase.from("orders").insert(orderRow).select("id").single();
      if (error) continue;
      orderId = ins.id;
    }

    for (const li of o.line_items ?? []) {
      if (!li.variant_id) continue;
      const { data: variant } = await supabase.from("variants").select("id, product_id")
        .eq("shopify_variant_id", String(li.variant_id)).maybeSingle();
      if (!variant?.id) continue;
      await supabase.from("order_items").insert({
        order_id: orderId,
        variant_id: variant.id,
        product_id: variant.product_id,
        quantity: Number(li.quantity ?? 0),
        unit_price: Number(li.price ?? 0),
        store_id: conn.store_id,
      });
    }
    totalRef.n++;
  }

  const link = res.headers.get("Link") ?? res.headers.get("link");
  const nextPageInfo = parseNextPageInfo(link);

  await updateLog(supabase, log.id, {
    current_stage: "orders",
    current_page: page + 1,
    cursor: nextPageInfo,
    records_synced: totalRef.n,
  });

  return nextPageInfo !== null;
}

// FIXED: saves cursor so it can resume if interrupted
async function syncInventory(supabase: any, conn: any, log: any, totalRef: { n: number }): Promise<boolean> {
  const domain = normalizeDomain(conn.shop_domain);
  const startOffset = log.current_stage === "inventory" ? (log.current_page ?? 0) * 50 : 0;

  const { data: variants } = await supabase.from("variants")
    .select("id, shopify_inventory_item_id")
    .eq("store_id", conn.store_id)
    .not("shopify_inventory_item_id", "is", null)
    .range(startOffset, startOffset + 49);

  if (!variants || variants.length === 0) return false;

  const ids = variants.map((v: any) => v.shopify_inventory_item_id);
  const path = `/inventory_levels.json?inventory_item_ids=${ids.join(",")}&limit=250`;
  const res = await shopifyFetch(domain, conn.access_token, path);

  if (res.ok) {
    const json = await res.json();
    const levels = json.inventory_levels ?? [];
    const totals: Record<string, number> = {};
    for (const lvl of levels) {
      const k = String(lvl.inventory_item_id);
      totals[k] = (totals[k] ?? 0) + Number(lvl.available ?? 0);
    }
    for (const [iid, qty] of Object.entries(totals)) {
      await supabase.from("variants").update({ inventory_quantity: qty })
        .eq("shopify_inventory_item_id", iid);
      totalRef.n++;
    }
  }

  const page = (log.current_page ?? 0) + 1;
  await updateLog(supabase, log.id, {
    current_stage: "inventory",
    current_page: page,
    records_synced: totalRef.n,
  });

  // If we got a full batch, there may be more
  return variants.length === 50;
}

// ------------ Orchestrator ------------
async function syncShopifyData(supabase: any, connectionId: string) {
  const { data: conn } = await supabase
    .from("shopify_connections").select("*").eq("id", connectionId).single();
  if (!conn || !conn.is_active || !conn.access_token) {
    console.warn("sync aborted: missing/inactive connection");
    return;
  }

  const log = await createOrResumeLog(supabase, connectionId, conn.store_id);
  const totalRef = { n: log.records_synced ?? 0 };
  // Use last successful sync time as incremental filter — only changed records
  const syncSince: string | null = conn.last_sync_at ?? null;

  await supabase.from("shopify_connections").update({ last_sync_status: "in_progress" }).eq("id", connectionId);

  try {
    const currentStage = (log.current_stage as Stage) || "products";
    const currentIdx = STAGES.indexOf(currentStage as any);

    let hasMore = false;
    if (currentStage === "products") {
      hasMore = await syncProducts(supabase, conn, log, totalRef, syncSince);
    } else if (currentStage === "collections") {
      hasMore = await syncCollections(supabase, conn, log, totalRef);
    } else if (currentStage === "orders") {
      hasMore = await syncOrders(supabase, conn, log, totalRef, syncSince);
    } else if (currentStage === "inventory") {
      hasMore = await syncInventory(supabase, conn, log, totalRef);
    }

    if (hasMore) {
      await triggerContinue(connectionId);
      return;
    }

    const nextStage = STAGES[currentIdx + 1];
    if (nextStage) {
      await updateLog(supabase, log.id, {
        current_stage: nextStage,
        current_page: 0,
        cursor: null,
        records_synced: totalRef.n,
      });
      await triggerContinue(connectionId);
    } else {
      await updateLog(supabase, log.id, {
        status: "success",
        completed_at: new Date().toISOString(),
        records_synced: totalRef.n,
        current_stage: "complete",
        cursor: null,
      });
      await supabase.from("shopify_connections").update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: "success",
        last_sync_records: totalRef.n,
      }).eq("id", connectionId);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("sync failed:", msg);
    await updateLog(supabase, log.id, {
      status: "failed",
      error_message: msg,
      records_synced: totalRef.n,
    });
    await supabase.from("shopify_connections").update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: "failed",
    }).eq("id", connectionId);
  }
}

// ------------ HTTP entry ------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "test") {
      const domain = normalizeDomain(body.shop_domain || "");
      const token = String(body.access_token || "");
      if (!domain || !token) return json(400, { ok: false, error: "Missing shop_domain or access_token" });
      const result = await testCredentials(domain, token);
      return json(result.ok ? 200 : 401, result);
    }

    if (action === "connect") {
      const domain = normalizeDomain(body.shop_domain || "");
      const token = String(body.access_token || "");
      const storeId = body.store_id ?? null;
      if (!domain || !token) return json(400, { ok: false, error: "Missing fields" });
      const test = await testCredentials(domain, token);
      if (!test.ok) return json(401, { ok: false, error: "Invalid credentials", details: test.error });

      if (storeId) {
        await supabase.from("shopify_connections").update({ is_active: false })
          .eq("store_id", storeId).eq("is_active", true);
      }
      const { data: conn, error: insErr } = await supabase.from("shopify_connections").insert({
        store_id: storeId, shop_domain: domain, access_token: token, is_active: true,
        connected_at: new Date().toISOString(), last_sync_status: "in_progress",
      }).select("*").single();
      if (insErr) throw new Error(insErr.message);

      // @ts-ignore
      EdgeRuntime.waitUntil(syncShopifyData(supabase, conn.id));
      return json(200, { ok: true, connection: conn, sync: { status: "queued" } });
    }

    if (action === "disconnect") {
      const id = String(body.connection_id || "");
      if (!id) return json(400, { ok: false, error: "Missing connection_id" });
      await supabase.from("shopify_connections").update({
        is_active: false, access_token: null, auto_sync_enabled: false,
        last_sync_status: null, last_sync_at: null, last_sync_records: 0,
      }).eq("id", id);
      await supabase.from("shopify_sync_logs").update({ status: "cancelled" })
        .eq("connection_id", id).eq("status", "in_progress");
      return json(200, { ok: true });
    }

    if (action === "sync") {
      const id = String(body.connection_id || "");
      if (!id) return json(400, { ok: false, error: "Missing connection_id" });
      // @ts-ignore
      EdgeRuntime.waitUntil(syncShopifyData(supabase, id));
      return json(200, { ok: true, status: "queued" });
    }

    if (action === "continue_sync") {
      const id = String(body.connection_id || "");
      if (!id) return json(400, { ok: false, error: "Missing connection_id" });
      // @ts-ignore
      EdgeRuntime.waitUntil(syncShopifyData(supabase, id));
      return json(200, { ok: true, status: "continuing" });
    }

    if (action === "auto_sync_tick") {
      const { data: conns } = await supabase.from("shopify_connections")
        .select("*").eq("is_active", true).eq("auto_sync_enabled", true);
      const now = Date.now();
      const freqMs: Record<string, number> = { "15min": 15*60*1000, "30min": 30*60*1000, "1hr": 60*60*1000 };
      const ran: string[] = [];
      for (const c of conns ?? []) {
        const interval = freqMs[c.sync_frequency] ?? freqMs["1hr"];
        const last = c.last_sync_at ? new Date(c.last_sync_at).getTime() : 0;
        if (now - last >= interval && c.last_sync_status !== "in_progress") {
          // @ts-ignore
          EdgeRuntime.waitUntil(syncShopifyData(supabase, c.id));
          ran.push(c.id);
        }
      }
      return json(200, { ok: true, ran });
    }

    if (action === "get_locations") {
      const connectionId = String(body.connection_id || "");
      if (!connectionId) return json(400, { ok: false, error: "Missing connection_id" });
      const { data: conn } = await supabase.from("shopify_connections")
        .select("shop_domain, access_token").eq("id", connectionId).single();
      if (!conn?.access_token) return json(404, { ok: false, error: "Connection not found" });
      const domain = normalizeDomain(conn.shop_domain);
      const res = await shopifyFetch(domain, conn.access_token, "/locations.json");
      if (!res.ok) return json(res.status, { ok: false, error: `Shopify error ${res.status}` });
      const data = await res.json();
      return json(200, { ok: true, locations: data.locations ?? [] });
    }

    if (action === "adjust_inventory") {
      const { connection_id, inventory_item_id, location_id, adjustment } = body;
      if (!connection_id || !inventory_item_id || !location_id || adjustment === undefined) {
        return json(400, { ok: false, error: "Missing required fields" });
      }
      const { data: conn } = await supabase.from("shopify_connections")
        .select("shop_domain, access_token").eq("id", String(connection_id)).single();
      if (!conn?.access_token) return json(404, { ok: false, error: "Connection not found" });
      const domain = normalizeDomain(conn.shop_domain);
      const res = await shopifyMutate(domain, conn.access_token, "POST", "/inventory_levels/adjust.json", {
        location_id: Number(location_id),
        inventory_item_id: Number(inventory_item_id),
        available_adjustment: Number(adjustment),
      });
      if (!res.ok) {
        const text = await res.text();
        return json(res.status, { ok: false, error: text.slice(0, 300) });
      }
      const data = await res.json();
      return json(200, { ok: true, inventory_level: data.inventory_level });
    }

    if (action === "edit_price") {
      const { connection_id, shopify_variant_id, new_price, new_compare_at_price } = body;
      if (!connection_id || !shopify_variant_id || new_price === undefined) {
        return json(400, { ok: false, error: "Missing required fields" });
      }
      const { data: conn } = await supabase.from("shopify_connections")
        .select("shop_domain, access_token").eq("id", String(connection_id)).single();
      if (!conn?.access_token) return json(404, { ok: false, error: "Connection not found" });
      const domain = normalizeDomain(conn.shop_domain);
      const variantPayload: Record<string, unknown> = {
        id: Number(shopify_variant_id),
        price: Number(new_price).toFixed(2),
      };
      if (new_compare_at_price !== undefined) {
        variantPayload.compare_at_price = new_compare_at_price === null
          ? null
          : Number(new_compare_at_price).toFixed(2);
      }
      const res = await shopifyMutate(domain, conn.access_token, "PUT", `/variants/${shopify_variant_id}.json`, {
        variant: variantPayload,
      });
      if (!res.ok) {
        const text = await res.text();
        return json(res.status, { ok: false, error: text.slice(0, 300) });
      }
      const data = await res.json();
      return json(200, { ok: true, variant: data.variant });
    }

    return json(400, { ok: false, error: "Unknown action" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json(500, { ok: false, error: msg });
  }
});