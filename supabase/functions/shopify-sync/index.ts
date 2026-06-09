// Shopify sync — resumable, multi-stage, runs in background to avoid 150s edge timeout
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdidmJ2b3BlaWVxZ2h2ZXR0bWtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MDMzNDksImV4cCI6MjA5MzI3OTM0OX0.bezMzljmBaqGo0kuThNO5tIuLDeWXaVnbAn8O2ZD5dM";
const INVOKE_URL = `${SUPABASE_URL}/functions/v1/shopify-sync`;
const STAGES = ["products", "collections", "orders", "inventory", "abandoned_checkouts"] as const;
type Stage = typeof STAGES[number];

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

async function triggerContinue(connectionId: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(INVOKE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({ action: "continue_sync", connection_id: connectionId }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) return;
      console.warn(`self-invoke attempt ${attempt + 1} got status ${res.status}`);
    } catch (e) {
      clearTimeout(timer);
      console.error(`self-invoke attempt ${attempt + 1} failed:`, e);
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  console.error("self-invoke failed after 3 attempts — pg_cron will rescue within 15 min");
}

async function shopifyMutate(domain: string, token: string, method: "POST" | "PUT" | "DELETE", path: string, requestBody?: unknown): Promise<Response> {
  const url = `https://${domain}/admin/api/2024-01${path}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch(url, {
        method,
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        body: requestBody !== undefined ? JSON.stringify(requestBody) : undefined,
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

const WEBHOOK_TOPICS = [
  "products/create", "products/update", "products/delete",
  "orders/create", "orders/updated",
  "fulfillments/create", "fulfillments/update",
  "inventory_levels/update",
  "collections/create", "collections/update",
];

async function registerWebhooks(supabase: any, connectionId: string) {
  const { data: conn } = await supabase.from("shopify_connections")
    .select("shop_domain, access_token").eq("id", connectionId).single();
  if (!conn?.access_token) return;

  const domain = normalizeDomain(conn.shop_domain);
  const secret = crypto.randomUUID().replace(/-/g, "");
  await supabase.from("shopify_connections").update({ webhook_secret: secret }).eq("id", connectionId);

  const webhookBase = `${SUPABASE_URL}/functions/v1/shopify-sync`;

  // Remove any existing webhooks pointing to this function
  const listRes = await shopifyFetch(domain, conn.access_token, "/webhooks.json?limit=250");
  if (listRes.ok) {
    const { webhooks } = await listRes.json();
    for (const wh of webhooks ?? []) {
      if (String(wh.address).includes("shopify-sync")) {
        await shopifyMutate(domain, conn.access_token, "DELETE", `/webhooks/${wh.id}.json`);
      }
    }
  }

  // Register fresh webhooks for all change topics
  for (const topic of WEBHOOK_TOPICS) {
    await shopifyMutate(domain, conn.access_token, "POST", "/webhooks.json", {
      webhook: { topic, address: `${webhookBase}?action=webhook&token=${secret}`, format: "json" },
    });
  }
  console.log(`Registered ${WEBHOOK_TOPICS.length} webhooks for connection ${connectionId}`);
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
      .update({
        status: "in_progress",
        error_message: null,
        // Preserve existing metadata (collection_map etc.) when resuming
        metadata: { ...(failed.metadata ?? {}), heartbeat_at: new Date().toISOString() },
      })
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

async function updateLog(supabase: any, logId: string, patch: Record<string, unknown>, currentMeta?: Record<string, unknown>) {
  const { metadata: patchMeta, ...rest } = patch as Record<string, unknown>;
  // Merge metadata: preserve existing keys (especially collection_map) across invocations
  const merged: Record<string, unknown> = {
    ...(currentMeta ?? {}),
    ...((patchMeta as Record<string, unknown>) ?? {}),
    heartbeat_at: new Date().toISOString(),
  };
  await supabase.from("shopify_sync_logs").update({ ...rest, metadata: merged }).eq("id", logId);
}

// ------------ Stage handlers ------------

async function syncProducts(supabase: any, conn: any, log: any, totalRef: { n: number }, syncSince: string | null): Promise<boolean> {
  const domain = normalizeDomain(conn.shop_domain);
  const pageInfo: string | null = log.current_stage === "products" ? log.cursor : null;
  const page: number = log.current_stage === "products" ? (log.current_page ?? 0) : 0;

  // 25 products per page — each product has many sequential DB calls; 50 reliably hits the 150s timeout
  const path = pageInfo
    ? `/products.json?limit=25&page_info=${encodeURIComponent(pageInfo)}`
    : syncSince
      ? `/products.json?limit=25&updated_at_min=${encodeURIComponent(syncSince)}`
      : `/products.json?limit=25`;
  const res = await shopifyFetch(domain, conn.access_token, path);
  if (!res.ok) throw new Error(`products [${res.status}]: ${(await res.text()).slice(0, 200)}`);

  const json = await res.json();
  const products = json.products ?? [];

  for (const p of products) {
    const productSku = p.variants?.[0]?.sku || `shopify-${p.id}`;

    // Upsert vendor
    let vendorId: string | null = null;
    if (p.vendor) {
      const { data: vendor } = await supabase
        .from("vendors")
        .upsert({ name: p.vendor }, { onConflict: "name" })
        .select("id")
        .single();
      vendorId = vendor?.id ?? null;
    }

    const productRow = {
      name: p.title,
      sku: productSku,
      slug: p.handle,
      product_type: p.product_type || null,
      status: p.status || "active",
      shopify_product_id: String(p.id),
      store_id: conn.store_id,
      image_alt_text: p.images?.[0]?.alt || null,
      // Preserve Shopify's original created_at so stock-aging calculations are accurate
      created_at: p.created_at ? new Date(p.created_at).toISOString() : undefined,
      ...(vendorId ? { vendor_id: vendorId } : {}),
    };
    const { data: existing, error: findProductErr } = await supabase
      .from("products")
      .select("id")
      .eq("store_id", conn.store_id)
      .eq("shopify_product_id", String(p.id))
      .maybeSingle();
    if (findProductErr) throw findProductErr;

    let productId: string;
    if (existing?.id) {
      const { error: updateProductErr } = await supabase.from("products").update(productRow).eq("id", existing.id);
      if (updateProductErr) throw updateProductErr;
      productId = existing.id;
    } else {
      const { data: ins, error } = await supabase.from("products").insert(productRow).select("id").single();
      if (error) throw error;
      productId = ins.id;
    }

    // Process all variants in parallel — eliminates the biggest sequential bottleneck
    const variants = p.variants ?? [];
    await Promise.all(variants.map(async (v: any) => {
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
      const { data: existV, error: findVariantErr } = await supabase
        .from("variants")
        .select("id, campaign_name")
        .eq("store_id", conn.store_id)
        .eq("shopify_variant_id", String(v.id))
        .maybeSingle();
      if (findVariantErr) throw findVariantErr;
      if (existV?.id) {
        // If variant is under an active campaign, protect its price/compare_at_price
        // so a sync pull from Shopify doesn't overwrite campaign-managed prices
        const updateRow = existV.campaign_name
          ? { ...variantRow, price: undefined, compare_at_price: undefined }
          : variantRow;
        const { error: updateVariantErr } = await supabase.from("variants").update(updateRow).eq("id", existV.id);
        if (updateVariantErr) throw updateVariantErr;
      } else {
        const { error: insertVariantErr } = await supabase.from("variants").insert(variantRow);
        if (insertVariantErr) throw insertVariantErr;
      }
      totalRef.n++;
    }));

    // Process all tags in parallel
    const tags: string[] = (p.tags ? String(p.tags).split(",").map((t: string) => t.trim()).filter(Boolean) : []);
    await Promise.all(tags.map(async (tagName: string) => {
      const { data: tag } = await supabase.from("tags").upsert({ name: tagName }, { onConflict: "name" }).select("id").single();
      if (tag?.id) {
        await supabase.from("product_tags").upsert({ product_id: productId, tag_id: tag.id }, { onConflict: "product_id,tag_id" });
      }
    }));
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
async function syncCollections(supabase: any, conn: any, log: any, totalRef: { n: number }, syncSince: string | null): Promise<boolean> {
    const domain = normalizeDomain(conn.shop_domain);

  // Cursor format: "meta:custom:PAGE_INFO", "meta:smart:PAGE_INFO", "collects:PAGE_INFO", or null
  const savedCursor: string | null = log.cursor ?? null;
  // collection_map persists across invocations in log.metadata: { shopifyCollectionId → dbCollectionId }
  const existingMap: Record<string, string> = (log.metadata?.collection_map ?? {}) as Record<string, string>;
  // custom_shopify_ids: shopify IDs of manually-curated collections (not smart/automated)
  const existingCustomIds: string[] = (log.metadata?.custom_shopify_ids ?? []) as string[];

  // --- Phase 1a: custom_collections metadata ---
  if (!savedCursor || savedCursor.startsWith("meta:custom:")) {
    const pageInfo = savedCursor?.startsWith("meta:custom:") ? savedCursor.slice("meta:custom:".length) : null;
    const path = pageInfo
      ? `/custom_collections.json?limit=50&page_info=${encodeURIComponent(pageInfo)}`
      : syncSince
        ? `/custom_collections.json?limit=50&updated_at_min=${encodeURIComponent(syncSince)}`
        : `/custom_collections.json?limit=50`;
    const res = await shopifyFetch(domain, conn.access_token, path);
    const pageMap: Record<string, string> = {};
    const pageCustomIds: string[] = [];
    if (res.ok) {
      const json = await res.json();
      for (const c of json.custom_collections ?? []) {
        const dbId = await upsertCollection(supabase, c, conn.store_id);
        if (dbId) { pageMap[String(c.id)] = dbId; pageCustomIds.push(String(c.id)); }
        totalRef.n++;
      }
      const link = res.headers.get("Link") ?? res.headers.get("link");
      const next = parseNextPageInfo(link);
      const merged = { ...existingMap, ...pageMap };
      const mergedCustomIds = [...existingCustomIds, ...pageCustomIds];
      if (next) {
        await updateLog(supabase, log.id,
          { current_stage: "collections", cursor: `meta:custom:${next}`, records_synced: totalRef.n, metadata: { collection_map: merged, custom_shopify_ids: mergedCustomIds } },
          log.metadata);
        return true;
      }
      // All custom pages done — advance to smart
      await updateLog(supabase, log.id,
        { current_stage: "collections", cursor: "meta:smart:", records_synced: totalRef.n, metadata: { collection_map: merged, custom_shopify_ids: mergedCustomIds } },
        log.metadata);
    } else {
      await updateLog(supabase, log.id,
        { current_stage: "collections", cursor: "meta:smart:", records_synced: totalRef.n },
        log.metadata);
    }
    return true;
  }

  // --- Phase 1b: smart_collections metadata ---
  if (savedCursor.startsWith("meta:smart:")) {
    const pageInfo = savedCursor.slice("meta:smart:".length) || null;
    const path = pageInfo
      ? `/smart_collections.json?limit=50&page_info=${encodeURIComponent(pageInfo)}`
      : syncSince
        ? `/smart_collections.json?limit=50&updated_at_min=${encodeURIComponent(syncSince)}`
        : `/smart_collections.json?limit=50`;
    const res = await shopifyFetch(domain, conn.access_token, path);
    const pageMap: Record<string, string> = {};
    if (res.ok) {
      const json = await res.json();
      for (const c of json.smart_collections ?? []) {
        const dbId = await upsertCollection(supabase, c, conn.store_id);
        if (dbId) pageMap[String(c.id)] = dbId;
        totalRef.n++;
      }
      const link = res.headers.get("Link") ?? res.headers.get("link");
      const next = parseNextPageInfo(link);
      const merged = { ...existingMap, ...pageMap };
      if (next) {
        await updateLog(supabase, log.id,
          { current_stage: "collections", cursor: `meta:smart:${next}`, records_synced: totalRef.n, metadata: { collection_map: merged } },
          log.metadata);
        return true;
      }
      // All smart pages done — advance to per-collection product linking.
      // Expand merged with ALL DB collections for this store so incremental syncs
      // (which only fetch recently-updated collections in Phase 1) still relink every product.
      const { data: allStoreCols } = await supabase
        .from("collections").select("id, shopify_collection_id")
        .eq("store_id", conn.store_id).not("shopify_collection_id", "is", null);
      const fullMap = { ...merged };
      for (const row of (allStoreCols ?? []) as { id: string; shopify_collection_id: string }[]) {
        if (!fullMap[row.shopify_collection_id]) fullMap[row.shopify_collection_id] = row.id;
      }
      const collIds = Object.keys(fullMap);
      if (collIds.length > 0) {
        await updateLog(supabase, log.id,
          { current_stage: "collections", cursor: `by_coll:${collIds[0]}:`, records_synced: totalRef.n, metadata: { collection_map: fullMap, collection_ids_ordered: collIds } },
          log.metadata);
        return true;
      } else {
        await updateLog(supabase, log.id,
          { current_stage: "collections", cursor: null, records_synced: totalRef.n, metadata: { collection_map: fullMap } },
          log.metadata);
        return false;
      }
    } else {
      // Smart collections fetch failed — advance using whatever custom collections we have,
      // but also pull all existing DB collections so we don't miss unmodified ones.
      const { data: allStoreCols2 } = await supabase
        .from("collections").select("id, shopify_collection_id")
        .eq("store_id", conn.store_id).not("shopify_collection_id", "is", null);
      const fallbackMap = { ...existingMap };
      for (const row of (allStoreCols2 ?? []) as { id: string; shopify_collection_id: string }[]) {
        if (!fallbackMap[row.shopify_collection_id]) fallbackMap[row.shopify_collection_id] = row.id;
      }
      const collIds = Object.keys(fallbackMap);
      if (collIds.length > 0) {
        await updateLog(supabase, log.id,
          { current_stage: "collections", cursor: `by_coll:${collIds[0]}:`, records_synced: totalRef.n, metadata: { collection_map: fallbackMap, collection_ids_ordered: collIds } },
          log.metadata);
        return true;
      } else {
        await updateLog(supabase, log.id,
          { current_stage: "collections", cursor: null, records_synced: totalRef.n },
          log.metadata);
        return false;
      }
    }
  }

  // --- Phase 2: link products to collections via per-collection fetch ---
  // /collects.json only covers custom collections; this approach works for smart collections too
  if (savedCursor.startsWith("by_coll:") || savedCursor.startsWith("collects:")) {
    // Migrate any stale "collects:" cursor from before this fix
    if (savedCursor.startsWith("collects:")) {
      const collIds = Object.keys(existingMap);
      if (collIds.length === 0) {
        await updateLog(supabase, log.id, { current_stage: "collections", cursor: null, records_synced: totalRef.n }, log.metadata);
        return false;
      }
      await updateLog(supabase, log.id,
        { current_stage: "collections", cursor: `by_coll:${collIds[0]}:`, records_synced: totalRef.n, metadata: { collection_map: existingMap, collection_ids_ordered: collIds } },
        log.metadata);
      return true;
    }

    const rest = savedCursor.slice("by_coll:".length);
    const colonIdx = rest.indexOf(":");
    const shopifyCollId = rest.slice(0, colonIdx);
    const pageInfo = rest.slice(colonIdx + 1) || null;
    const collId = existingMap[shopifyCollId];
    const allCollIds: string[] = ((log.metadata?.collection_ids_ordered) as string[] | undefined) ?? Object.keys(existingMap);
    const currentIdx = allCollIds.indexOf(shopifyCollId);
    // Custom collections are the authoritative primary collection; smart ones are secondary
    const customShopifyIds = new Set<string>((log.metadata?.custom_shopify_ids ?? []) as string[]);
    const isCustomCollection = customShopifyIds.has(shopifyCollId);
    // Operational/storefront collections — never set as a product's primary collection
    const EXCLUDED_PRIMARY_NAMES = new Set(["Trending Now", "Top Selling"]);
    const { data: collMeta } = await supabase.from("collections").select("name").eq("id", collId).maybeSingle();
    const isExcludedPrimary = collMeta?.name ? EXCLUDED_PRIMARY_NAMES.has(collMeta.name) : false;

    if (collId && shopifyCollId) {
      try {
        const path = pageInfo
          ? `/collections/${shopifyCollId}/products.json?limit=250&page_info=${encodeURIComponent(pageInfo)}`
          : `/collections/${shopifyCollId}/products.json?limit=250`;
        const res = await shopifyFetch(domain, conn.access_token, path);
        if (res.ok) {
          const json = await res.json();
          const shopifyProds: any[] = json.products ?? [];
          if (shopifyProds.length > 0) {
            const shopifyIds = shopifyProds.map((p: any) => String(p.id));
            const { data: dbProds } = await supabase.from("products").select("id, shopify_product_id")
              .in("shopify_product_id", shopifyIds);
            const prodMap = new Map<string, string>(
              ((dbProds ?? []) as any[]).map((d: any) => [d.shopify_product_id, d.id])
            );
            // Parallel product-collection links — avoids sequential update bottleneck
            await Promise.all(shopifyProds.map(async (p: any) => {
              const prodId = prodMap.get(String(p.id));
              if (!prodId) return;
              // Skip setting collection_id for operational collections (Trending Now, Top Selling)
              // so real category collections always win. Still upsert into product_collections for filtering.
              if (!isExcludedPrimary) {
                // Custom collections always win as primary; smart collections only fill in if no primary is set
                if (isCustomCollection) {
                  await supabase.from("products").update({ collection_id: collId }).eq("id", prodId);
                } else {
                  await supabase.from("products").update({ collection_id: collId }).eq("id", prodId).is("collection_id", null);
                }
              }
              await supabase.from("product_collections")
                .upsert({ product_id: prodId, collection_id: collId }, { onConflict: "product_id,collection_id" });
              totalRef.n++;
            }));
          }
          const link = res.headers.get("Link") ?? res.headers.get("link");
          const next = parseNextPageInfo(link);
          if (next) {
            await updateLog(supabase, log.id,
              { current_stage: "collections", cursor: `by_coll:${shopifyCollId}:${next}`, records_synced: totalRef.n },
              log.metadata);
            return true;
          }
        }
      } catch (e) {
        // Skip this collection and move on — don't let one bad collection stall the entire sync
        console.warn(`by_coll:${shopifyCollId} failed, skipping:`, e);
      }
    }

    // Move to next collection
    const nextCollId = allCollIds[currentIdx + 1];
    if (nextCollId) {
      await updateLog(supabase, log.id,
        { current_stage: "collections", cursor: `by_coll:${nextCollId}:`, records_synced: totalRef.n },
        log.metadata);
      return true;
    }

    // All collections processed
    await updateLog(supabase, log.id,
      { current_stage: "collections", cursor: null, records_synced: totalRef.n },
      log.metadata);
    return false;
  }

  return false;
}

async function upsertCollection(supabase: any, c: any, storeId: string): Promise<string | null> {
  const shopifyId = String(c.id);
  // Look up by shopify_collection_id scoped to this store (store-specific collections)
  const { data: existing } = await supabase
    .from("collections").select("id").eq("shopify_collection_id", shopifyId).eq("store_id", storeId).maybeSingle();
  if (existing?.id) {
    await supabase.from("collections").update({ name: c.title }).eq("id", existing.id);
    return existing.id;
  }
  // Fall back: look up by shopify_collection_id only (rows before store_id column existed)
  const { data: byShopifyId } = await supabase
    .from("collections").select("id").eq("shopify_collection_id", shopifyId).maybeSingle();
  if (byShopifyId?.id) {
    await supabase.from("collections").update({ name: c.title, store_id: storeId }).eq("id", byShopifyId.id);
    return byShopifyId.id;
  }
  // Find by name within the same store
  const { data: byName } = await supabase
    .from("collections").select("id").eq("name", c.title).eq("store_id", storeId).maybeSingle();
  if (byName?.id) {
    await supabase.from("collections").update({ shopify_collection_id: shopifyId }).eq("id", byName.id);
    return byName.id;
  }
  // Insert new store-specific collection row
  const { data: ins, error } = await supabase
    .from("collections")
    .insert({ name: c.title, shopify_collection_id: shopifyId, store_id: storeId })
    .select("id").single();
  if (!error && ins?.id) return ins.id;
  // shopify_collection_id conflict (duplicate) — try without it
  const { data: ins2 } = await supabase
    .from("collections")
    .insert({ name: c.title, store_id: storeId })
    .select("id").single();
  return ins2?.id ?? null;
}

// Fetches a missing variant from Shopify and inserts it into the DB.
// Returns the variant row ({ id, product_id }) or null if it can't be resolved.
async function fetchAndInsertVariant(supabase: any, conn: any, shopifyVariantId: string): Promise<{ id: string; product_id: string } | null> {
  const domain = normalizeDomain(conn.shop_domain);
  const res = await shopifyFetch(domain, conn.access_token, `/variants/${shopifyVariantId}.json`);
  if (!res.ok) return null;
  const { variant: v } = await res.json();
  if (!v) return null;

  const { data: product } = await supabase
    .from("products")
    .select("id")
    .eq("store_id", conn.store_id)
    .eq("shopify_product_id", String(v.product_id))
    .maybeSingle();
  if (!product?.id) return null;

  const variantRow = {
    product_id: product.id,
    variant_sku: v.sku || `shopify-v-${v.id}`,
    size: v.option1 || v.title || "Default",
    price: Number(v.price ?? 0),
    compare_at_price: v.compare_at_price ? Number(v.compare_at_price) : null,
    inventory_quantity: Number(v.inventory_quantity ?? 0),
    shopify_variant_id: String(v.id),
    shopify_inventory_item_id: v.inventory_item_id ? String(v.inventory_item_id) : null,
    store_id: conn.store_id,
  };

  const { data: existing } = await supabase
    .from("variants")
    .select("id, product_id")
    .eq("store_id", conn.store_id)
    .eq("shopify_variant_id", String(v.id))
    .maybeSingle();

  if (existing?.id) {
    const { data: updated } = await supabase
      .from("variants")
      .update(variantRow)
      .eq("id", existing.id)
      .select("id, product_id")
      .single();
    return updated ?? null;
  }

  const { data: inserted } = await supabase
    .from("variants")
    .insert(variantRow)
    .select("id, product_id")
    .single();

  return inserted ?? null;
}

// Upserts a single Shopify order and its line items.
// Used by both the bulk sync loop and the real-time webhook handler.
async function processSingleOrder(supabase: any, conn: any, o: any): Promise<void> {
  const orderRow = {
    order_number: String(o.name || o.order_number || o.id),
    status: o.financial_status || o.fulfillment_status || "unknown",
    financial_status: o.financial_status || null,
    fulfillment_status: o.fulfillment_status || null,
    order_status: o.cancelled_at ? "cancelled" : o.closed_at ? "closed" : "open",
    closed_at: o.closed_at || null,
    cancelled_at: o.cancelled_at || null,
    source_name: o.source_name || null,
    shopify_created_at: o.created_at || null,
    total_price: o.total_price ? Number(o.total_price) : null,
    shopify_order_id: String(o.id),
    store_id: conn.store_id,
    customer_email: o.email || o.customer?.email || null,
    shopify_customer_id: o.customer?.id ? String(o.customer.id) : null,
    customer_first_order_at: o.customer?.created_at || null,
    discount_codes: o.discount_codes?.length ? o.discount_codes : null,
    total_discounts: o.total_discounts ? Number(o.total_discounts) : null,
    referring_site: o.referring_site || null,
    landing_site: o.landing_site || null,
    tracking_number: o.fulfillments?.[0]?.tracking_number
      ?? o.fulfillments?.[0]?.tracking_numbers?.[0]
      ?? null,
  };

  const { data: existing, error: findOrderErr } = await supabase
    .from("orders")
    .select("id")
    .eq("store_id", conn.store_id)
    .eq("shopify_order_id", String(o.id))
    .maybeSingle();
  if (findOrderErr) throw findOrderErr;

  let orderId: string;
  if (existing?.id) {
    const { error: updateOrderErr } = await supabase.from("orders").update(orderRow).eq("id", existing.id);
    if (updateOrderErr) throw updateOrderErr;
    orderId = existing.id;
    const { error: deleteItemsErr } = await supabase.from("order_items").delete().eq("order_id", orderId);
    if (deleteItemsErr) throw deleteItemsErr;
  } else {
    const { data: ins, error } = await supabase.from("orders").insert(orderRow).select("id").single();
    if (error) throw error;
    orderId = ins.id;
  }

  for (const li of o.line_items ?? []) {
    if (!li.variant_id) continue;
    const { data: foundVariant, error: findLineVariantErr } = await supabase.from("variants").select("id, product_id")
      .eq("store_id", conn.store_id)
      .eq("shopify_variant_id", String(li.variant_id)).maybeSingle();
    if (findLineVariantErr) throw findLineVariantErr;
    let variant = foundVariant;

    // Variant not in DB yet — fetch from Shopify and insert on the fly
    if (!variant?.id) {
      variant = await fetchAndInsertVariant(supabase, conn, String(li.variant_id));
    }
    if (!variant?.id) continue;

    const { error: insertItemErr } = await supabase.from("order_items").insert({
      order_id: orderId,
      variant_id: variant.id,
      product_id: variant.product_id,
      quantity: Number(li.quantity ?? 0),
      unit_price: Number(li.price ?? 0),
      store_id: conn.store_id,
    });
    if (insertItemErr) throw insertItemErr;
  }
}

// FIXED: single page per invocation (was: all pages in one invocation)
async function syncOrders(supabase: any, conn: any, log: any, totalRef: { n: number }, syncSince: string | null): Promise<boolean> {
  const domain = normalizeDomain(conn.shop_domain);
  const pageInfo: string | null = log.current_stage === "orders" ? log.cursor : null;
  const page: number = log.current_stage === "orders" ? (log.current_page ?? 0) : 0;

  // Full sync goes back 3 years so historical orders are present for new-vs-returning classification.
  // Incremental syncs use updated_at_min so they only fetch changed orders.
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  const historicalStart = `${threeYearsAgo.getFullYear()}-01-01T00:00:00Z`;
  const path = pageInfo
    ? `/orders.json?limit=50&page_info=${encodeURIComponent(pageInfo)}`
    : syncSince
      ? `/orders.json?limit=50&status=any&updated_at_min=${encodeURIComponent(syncSince)}`
      : `/orders.json?limit=50&status=any&created_at_min=${encodeURIComponent(historicalStart)}`;
  const res = await shopifyFetch(domain, conn.access_token, path);
  if (!res.ok) throw new Error(`orders [${res.status}]: ${(await res.text()).slice(0, 200)}`);

  const json = await res.json();
  const orders = json.orders ?? [];

  for (const o of orders) {
    await processSingleOrder(supabase, conn, o);
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

// ------------ Velocity metrics refresh ------------
async function refreshVelocityMetrics(supabase: any, storeId: string | null) {
  try {
    const now = new Date();
    const windows = [
      { col: "units_sold_7d",  days: 7  },
      { col: "units_sold_14d", days: 14 },
      { col: "units_sold_21d", days: 21 },
      { col: "units_sold_30d", days: 30 },
    ];

    // Get all products for this store
    const productQ = storeId
      ? supabase.from("products").select("id").eq("store_id", storeId)
      : supabase.from("products").select("id");
    const { data: products } = await productQ;
    if (!products?.length) return;

    const allProductIds = (products as { id: string }[]).map(p => p.id);

    for (const { col, days } of windows) {
      const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();

      // Aggregate actual sales from order_items within the window
      let q = (supabase as any)
        .from("order_items")
        .select("product_id, quantity, orders!inner(cancelled_at, shopify_created_at)")
        .gte("orders.shopify_created_at", cutoff)
        .is("orders.cancelled_at", null);
      if (storeId) q = q.eq("store_id", storeId);
      const { data: items } = await q;

      // Build map of actual counts — products not in map get 0
      const map = new Map<string, number>();
      for (const item of (items ?? []) as any[]) {
        const pid = item.product_id as string;
        map.set(pid, (map.get(pid) ?? 0) + Number(item.quantity ?? 0));
      }

      // Upsert every product: real count if it sold, 0 if it didn't
      // This ensures stale values are always cleared on each refresh
      const upsertRows = allProductIds.map(productId => ({
        product_id: productId,
        [col]: map.get(productId) ?? 0,
        updated_at: now.toISOString(),
      }));

      // Batch in chunks of 500 to avoid request size limits
      for (let i = 0; i < upsertRows.length; i += 500) {
        await supabase.from("product_velocity_metrics").upsert(
          upsertRows.slice(i, i + 500),
          { onConflict: "product_id", ignoreDuplicates: false }
        );
      }
    }
  } catch (e) {
    console.warn("refreshVelocityMetrics failed (non-fatal):", e);
  }
}

// ------------ Abandoned checkouts ------------
async function syncAbandonedCheckouts(supabase: any, conn: any, log: any, totalRef: { n: number }, syncSince: string | null): Promise<boolean> {
  const domain = normalizeDomain(conn.shop_domain);
  const pageInfo: string | null = log.current_stage === "abandoned_checkouts" ? log.cursor : null;
  const page: number = log.current_stage === "abandoned_checkouts" ? (log.current_page ?? 0) : 0;

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const historicalStart = oneYearAgo.toISOString();

  const path = pageInfo
    ? `/checkouts.json?limit=50&page_info=${encodeURIComponent(pageInfo)}`
    : syncSince
      ? `/checkouts.json?limit=50&updated_at_min=${encodeURIComponent(syncSince)}`
      : `/checkouts.json?limit=50&created_at_min=${encodeURIComponent(historicalStart)}`;

  const res = await shopifyFetch(domain, conn.access_token, path);
  // 404 means the store plan doesn't expose this endpoint — skip gracefully
  if (res.status === 404) {
    await updateLog(supabase, log.id, { current_stage: "abandoned_checkouts", current_page: 0, cursor: null, records_synced: totalRef.n });
    return false;
  }
  if (!res.ok) throw new Error(`abandoned_checkouts [${res.status}]: ${(await res.text()).slice(0, 200)}`);

  const json = await res.json();
  const checkouts = (json.checkouts ?? []) as any[];

  for (const c of checkouts) {
    await supabase.from("abandoned_checkouts").upsert({
      store_id: conn.store_id,
      shopify_checkout_token: String(c.token),
      created_at: c.created_at || null,
      completed_at: c.completed_at || null,
      email: c.email || null,
      total_price: c.total_price ? Number(c.total_price) : null,
      source_name: c.source_name || null,
      referring_site: c.referring_site || null,
      landing_site: c.landing_site || null,
      currency: c.currency || null,
    }, { onConflict: "store_id,shopify_checkout_token" });
    totalRef.n++;
  }

  const link = res.headers.get("Link") ?? res.headers.get("link");
  const nextPageInfo = parseNextPageInfo(link);

  await updateLog(supabase, log.id, {
    current_stage: "abandoned_checkouts",
    current_page: page + 1,
    cursor: nextPageInfo,
    records_synced: totalRef.n,
  });

  return nextPageInfo !== null;
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
  const syncSince: string | null = conn.last_sync_at ?? null;

  await supabase.from("shopify_connections").update({ last_sync_status: "in_progress" }).eq("id", connectionId);

  // 110s budget — Supabase hard-kills at 150s. If we exceed it, state is saved
  // in the log and the next invocation (cron or manual) resumes from the cursor.
  try {
    const currentStage = (log.current_stage as Stage) || "products";
    const currentIdx = STAGES.indexOf(currentStage as any);

    let hasMore = false;
    if (currentStage === "products") {
      hasMore = await syncProducts(supabase, conn, log, totalRef, syncSince);
    } else if (currentStage === "collections") {
      hasMore = await syncCollections(supabase, conn, log, totalRef, syncSince);
    } else if (currentStage === "orders") {
      hasMore = await syncOrders(supabase, conn, log, totalRef, syncSince);
    } else if (currentStage === "inventory") {
      if (syncSince && conn.webhook_secret) {
        // Webhooks keep inventory current in real-time — skip full crawl on incremental runs
        hasMore = false;
      } else {
        hasMore = await syncInventory(supabase, conn, log, totalRef);
      }
    } else if (currentStage === "abandoned_checkouts") {
      hasMore = await syncAbandonedCheckouts(supabase, conn, log, totalRef, syncSince);
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
      await refreshVelocityMetrics(supabase, conn.store_id);
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

    // Shopify webhook receiver — identified by ?action=webhook&token=SECRET in URL
    const reqUrl = new URL(req.url);
    if (reqUrl.searchParams.get("action") === "webhook") {
      const token  = reqUrl.searchParams.get("token") ?? "";
      const topic  = req.headers.get("X-Shopify-Topic") ?? "";
      const { data: conn } = await supabase.from("shopify_connections")
        .select("id, store_id, shop_domain, access_token")
        .eq("webhook_secret", token).eq("is_active", true).maybeSingle();
      if (!conn?.id) return json(401, { ok: false, error: "Invalid webhook token" });

      const payload = await req.json().catch(() => null);

      if ((topic === "orders/create" || topic === "orders/updated") && payload) {
        // Process just this order directly — no full sync needed
        // @ts-ignore
        EdgeRuntime.waitUntil(processSingleOrder(supabase, conn, payload));
      } else {
        // Products, collections, inventory — trigger incremental sync
        // @ts-ignore
        EdgeRuntime.waitUntil(syncShopifyData(supabase, conn.id));
      }
      return json(200, { ok: true });
    }

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
        // Persist timezone (and other shop metadata) so date calculations are store-specific
        if (test.shop?.iana_timezone) {
          await supabase.from("stores").update({ timezone: test.shop.iana_timezone })
            .eq("id", storeId);
        }
      }
      const { data: conn, error: insErr } = await supabase.from("shopify_connections").insert({
        store_id: storeId, shop_domain: domain, access_token: token, is_active: true,
        connected_at: new Date().toISOString(), last_sync_status: "in_progress",
      }).select("*").single();
      if (insErr) throw new Error(insErr.message);

      // @ts-ignore
      EdgeRuntime.waitUntil((async () => {
        await registerWebhooks(supabase, conn.id);
        await syncShopifyData(supabase, conn.id);
      })());
      return json(200, { ok: true, connection: conn, sync: { status: "queued" } });
    }

    if (action === "register_webhooks") {
      const id = String(body.connection_id || "");
      if (!id) return json(400, { ok: false, error: "Missing connection_id" });
      await registerWebhooks(supabase, id);
      // @ts-ignore
      EdgeRuntime.waitUntil(syncShopifyData(supabase, id));
      return json(200, { ok: true, status: "webhooks_registered_sync_queued" });
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

    if (action === "force_resync") {
      const id = String(body.connection_id || "");
      if (!id) return json(400, { ok: false, error: "Missing connection_id" });
      // Cancel stuck logs so createOrResumeLog starts fresh
      await supabase.from("shopify_sync_logs")
        .update({ status: "cancelled" })
        .eq("connection_id", id)
        .in("status", ["in_progress", "failed"]);
      // Clear last_sync_at so syncSince = null → full year re-sync
      await supabase.from("shopify_connections")
        .update({ last_sync_at: null, last_sync_status: "in_progress" })
        .eq("id", id);
      // @ts-ignore
      EdgeRuntime.waitUntil(syncShopifyData(supabase, id));
      return json(200, { ok: true, status: "force_resync_queued" });
    }

    if (action === "continue_sync") {
      const id = String(body.connection_id || "");
      if (!id) return json(400, { ok: false, error: "Missing connection_id" });
      // @ts-ignore
      EdgeRuntime.waitUntil(syncShopifyData(supabase, id));
      return json(200, { ok: true, status: "continuing" });
    }

    if (action === "auto_sync_tick") {
      const now = Date.now();
      const STALE_MS = 15 * 60 * 1000; // heartbeat older than 15 min = stalled
      const freqMs: Record<string, number> = { "15min": 15*60*1000, "30min": 30*60*1000, "1hr": 60*60*1000 };
      const ran: string[] = [];

      // Pass 1: rescue stalled in-progress syncs across ALL active connections
      const { data: stalledConns } = await supabase.from("shopify_connections")
        .select("id").eq("is_active", true).eq("last_sync_status", "in_progress");
      for (const c of stalledConns ?? []) {
        const { data: log } = await supabase
          .from("shopify_sync_logs")
          .select("metadata")
          .eq("connection_id", c.id)
          .eq("status", "in_progress")
          .order("sync_time", { ascending: false })
          .limit(1)
          .maybeSingle();
        const heartbeat = (log?.metadata as any)?.heartbeat_at;
        const age = heartbeat ? now - new Date(heartbeat).getTime() : Infinity;
        if (age > STALE_MS) {
          console.log(`Rescuing stalled sync ${c.id} (heartbeat age: ${Math.round(age / 60000)}m)`);
          // @ts-ignore
          EdgeRuntime.waitUntil(syncShopifyData(supabase, c.id));
          ran.push(c.id);
        }
      }

      // Pass 2: trigger due auto-syncs for connections with auto_sync_enabled
      const { data: autoConns } = await supabase.from("shopify_connections")
        .select("*").eq("is_active", true).eq("auto_sync_enabled", true);
      for (const c of autoConns ?? []) {
        if (ran.includes(c.id)) continue; // already rescued above
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

    if (action === "push_prices") {
      const { campaign_id } = body;
      if (!campaign_id) return json(400, { ok: false, error: "campaign_id required" });

      // Get campaign to find its store
      const { data: campaign } = await supabase
        .from("pricing_campaigns").select("store_id").eq("id", campaign_id).single();
      if (!campaign?.store_id) return json(200, { ok: false, error: "Campaign or store not found" });

      // Get active Shopify connection for this store
      const { data: conn } = await supabase
        .from("shopify_connections")
        .select("shop_domain, access_token")
        .eq("store_id", campaign.store_id)
        .eq("is_active", true)
        .single();
      if (!conn?.access_token) return json(200, { ok: false, error: "No active Shopify connection for store" });

      // Get all campaign items with their new prices
      const { data: items, error: itemsErr } = await supabase
        .from("pricing_campaign_items")
        .select("variant_id, new_price, new_compare_at_price")
        .eq("campaign_id", campaign_id);
      if (itemsErr) throw itemsErr;
      if (!items?.length) return json(200, { ok: true, pushed: 0 });

      // Get shopify_variant_id for each variant
      const variantIds = items.map((i: any) => i.variant_id).filter(Boolean);
      const { data: variants } = await supabase
        .from("variants").select("id, shopify_variant_id").in("id", variantIds);
      const variantMap = new Map((variants ?? []).map((v: any) => [v.id, v.shopify_variant_id]));

      const domain = normalizeDomain(conn.shop_domain);
      let pushed = 0;
      const failed: string[] = [];

      for (const item of items as any[]) {
        const shopifyVarId = variantMap.get(item.variant_id);
        if (!shopifyVarId) { failed.push(String(item.variant_id)); continue; }
        const res = await shopifyMutate(domain, conn.access_token, "PUT", `/variants/${shopifyVarId}.json`, {
          variant: {
            id: Number(shopifyVarId),
            price: Number(item.new_price).toFixed(2),
            compare_at_price: item.new_compare_at_price != null
              ? Number(item.new_compare_at_price).toFixed(2)
              : null,
          },
        });
        if (res.ok) {
          pushed++;
        } else {
          const txt = await res.text();
          failed.push(`${shopifyVarId}: ${txt.slice(0, 120)}`);
        }
      }

      return json(200, { ok: failed.length === 0, pushed, failed });
    }

    if (action === "revert_prices") {
      const { campaign_id } = body;
      if (!campaign_id) return json(400, { ok: false, error: "campaign_id required" });

      // Get campaign to find its store
      const { data: campaign } = await supabase
        .from("pricing_campaigns").select("store_id").eq("id", campaign_id).single();
      if (!campaign?.store_id) return json(200, { ok: false, error: "Campaign or store not found" });

      // Get active Shopify connection for this store
      const { data: conn } = await supabase
        .from("shopify_connections")
        .select("shop_domain, access_token")
        .eq("store_id", campaign.store_id)
        .eq("is_active", true)
        .single();
      if (!conn?.access_token) return json(200, { ok: false, error: "No active Shopify connection for store" });

      // Fetch campaign items with original prices
      const { data: items, error: itemsErr } = await supabase
        .from("pricing_campaign_items")
        .select("variant_id, old_price, old_compare_at_price")
        .eq("campaign_id", campaign_id);
      if (itemsErr) throw itemsErr;
      if (!items?.length) return json(200, { ok: true, pushed: 0 });

      // Fetch shopify_variant_id for each variant
      const variantIds = items.map((i: { variant_id: string; old_price: number; old_compare_at_price: number | null }) => i.variant_id).filter(Boolean);
      const { data: variants } = await supabase
        .from("variants").select("id, shopify_variant_id").in("id", variantIds);
      const variantMap = new Map((variants ?? []).map((v: { id: string; shopify_variant_id: string | null }) => [v.id, v.shopify_variant_id]));

      const domain = normalizeDomain(conn.shop_domain);
      let pushed = 0;
      const failed: string[] = [];

      for (const item of items) {
        const shopifyVarId = variantMap.get(item.variant_id);
        if (!shopifyVarId) { failed.push(String(item.variant_id)); continue; }
        const res = await shopifyMutate(domain, conn.access_token, "PUT", `/variants/${shopifyVarId}.json`, {
          variant: {
            id: Number(shopifyVarId),
            price: Number(item.old_price).toFixed(2),
            compare_at_price: item.old_compare_at_price ? Number(item.old_compare_at_price).toFixed(2) : null,
          },
        });
        if (res.ok) {
          pushed++;
        } else {
          const txt = await res.text();
          failed.push(`${shopifyVarId}: ${txt.slice(0, 120)}`);
        }
      }

      return json(200, { ok: failed.length === 0, pushed, failed });
    }

    if (action === "sync_collections_meta") {
      const storeId = String(body.store_id || "");
      if (!storeId) return json(400, { ok: false, error: "store_id required" });
      const { data: conn } = await supabase.from("shopify_connections")
        .select("shop_domain, access_token, store_id")
        .eq("store_id", storeId).eq("is_active", true).single();
      if (!conn?.access_token) return json(404, { ok: false, error: "No active Shopify connection for store" });
      const domain = normalizeDomain(conn.shop_domain);

      const broadcast = async (stage: string, custom: number, smart: number) => {
        try {
          await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${SERVICE_ROLE}`,
              "apikey": ANON_KEY,
            },
            body: JSON.stringify({
              messages: [{
                topic: `realtime:collection-sync-${storeId}`,
                event: "broadcast",
                payload: { type: "broadcast", event: "progress", payload: { stage, custom, smart } },
              }],
            }),
          });
        } catch { /* non-critical */ }
      };

      let custom = 0, smart = 0;
      let customError: string | null = null, smartError: string | null = null;

      await broadcast("fetching_manual", 0, 0);

      // Fetch all custom collections and upsert with store_id
      let pageInfo: string | null = null;
      do {
        const path = pageInfo
          ? `/custom_collections.json?limit=250&page_info=${encodeURIComponent(pageInfo)}`
          : `/custom_collections.json?limit=250`;
        const res = await shopifyFetch(domain, conn.access_token, path);
        if (!res.ok) { customError = `custom_collections ${res.status}`; break; }
        const data = await res.json();
        if (data.errors) { customError = String(data.errors); break; }
        for (const c of data.custom_collections ?? []) {
          await upsertCollection(supabase, c, conn.store_id);
          custom++;
        }
        await broadcast("fetching_manual", custom, 0);
        pageInfo = parseNextPageInfo(res.headers.get("Link") ?? res.headers.get("link") ?? "");
      } while (pageInfo);

      await broadcast("fetching_smart", custom, 0);

      // Fetch all smart collections and upsert with store_id
      pageInfo = null;
      do {
        const path = pageInfo
          ? `/smart_collections.json?limit=250&page_info=${encodeURIComponent(pageInfo)}`
          : `/smart_collections.json?limit=250`;
        const res = await shopifyFetch(domain, conn.access_token, path);
        if (!res.ok) { smartError = `smart_collections ${res.status}`; break; }
        const data = await res.json();
        if (data.errors) { smartError = String(data.errors); break; }
        for (const c of data.smart_collections ?? []) {
          await upsertCollection(supabase, c, conn.store_id);
          smart++;
        }
        await broadcast("fetching_smart", custom, smart);
        pageInfo = parseNextPageInfo(res.headers.get("Link") ?? res.headers.get("link") ?? "");
      } while (pageInfo);

      await broadcast("done", custom, smart);
      if (customError || smartError) {
        return json(200, { ok: true, custom, smart, warnings: [customError, smartError].filter(Boolean) });
      }
      return json(200, { ok: true, custom, smart });
    }

    return json(400, { ok: false, error: "Unknown action" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json(500, { ok: false, error: msg });
  }
});
