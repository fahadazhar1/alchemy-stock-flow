// Collection Sort Manager — sorts Shopify collection products by language, stock, and date
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Safety caps so one oversized collection can't stall or blow up a run.
const COLLECTION_MAX_PAGES = 40; // 40 * 250 = 10,000 products per collection
const COLLECTION_TIMEOUT_MS = 90_000; // per-collection watchdog
const HEARTBEAT_INTERVAL_MS = 10_000; // keep the stream alive so the UI can tell "slow" from "hung"

function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

// ── Shopify GraphQL helper with retry + rate-limit handling ──────────────────

async function shopifyGQL(
  domain: string,
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Response> {
  const url = `https://${domain}/admin/api/2024-01/graphql.json`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.status === 429) {
        const retry = Number(res.headers.get("Retry-After") ?? "2");
        await sleep(retry * 1000 * (attempt + 1));
        continue;
      }
      if (res.status >= 500) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(timer);
      if (attempt === 5) throw e;
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
  throw new Error("Shopify GraphQL retries exhausted");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Database connection lookup ───────────────────────────────────────────────

async function getConnection(supabase: ReturnType<typeof createClient>, storeId: string) {
  const { data } = await supabase
    .from("shopify_connections")
    .select("shop_domain, access_token")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .single();
  return data as { shop_domain: string; access_token: string } | null;
}

// ── Fetch all collections for a store ────────────────────────────────────────

interface ShopifyCollection {
  id: string;
  title: string;
  handle: string;
}

async function fetchAllCollections(domain: string, token: string): Promise<ShopifyCollection[]> {
  const all: ShopifyCollection[] = [];
  let cursor: string | null = null;

  const query = `
    query GetCollections($first: Int!, $after: String) {
      collections(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id title handle }
      }
    }
  `;

  do {
    const res = await shopifyGQL(domain, token, query, { first: 250, after: cursor ?? undefined });
    if (!res.ok) throw new Error(`Collections fetch failed [${res.status}]`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors[0].message);
    const page = json.data?.collections;
    if (!page) throw new Error("No collections data in response");
    all.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  // Ensure the "All Products" (collections/all) collection is at the top of the list.
  // It may already be included by the paginated query (if created as a real collection),
  // or it may be a system collection only discoverable via direct handle lookup.
  const alreadyInList = all.find((c) => c.handle === "all");
  if (alreadyInList) {
    // Move it to the front without duplicating
    return [alreadyInList, ...all.filter((c) => c.handle !== "all")];
  }

  // Not in the paginated results — try direct lookups for system collections
  try {
    const r1 = await shopifyGQL(domain, token, `{ collection(handle: "all") { id title handle } }`);
    if (r1.ok) {
      const j1 = await r1.json();
      const col = j1.data?.collection;
      if (col?.id) return [col, ...all];
    }
    const r2 = await shopifyGQL(domain, token, `{ collections(first: 1, query: "handle:all") { nodes { id title handle } } }`);
    if (r2.ok) {
      const j2 = await r2.json();
      const col = j2.data?.collections?.nodes?.[0];
      if (col?.id && col.handle === "all") return [col, ...all];
    }
  } catch {
    // Non-fatal
  }

  return all;
}

// ── Create the "All Products" smart collection with handle "all" ─────────────

async function createAllProductsCollection(domain: string, token: string): Promise<{ id: string; handle: string; title: string } | null> {
  const mutation = `
    mutation collectionCreate($input: CollectionInput!) {
      collectionCreate(input: $input) {
        collection { id title handle }
        userErrors { field message }
      }
    }
  `;
  const res = await shopifyGQL(domain, token, mutation, {
    input: {
      title: "All Products",
      handle: "all",
      ruleSet: {
        appliedDisjunctively: false,
        rules: [{ column: "TITLE", relation: "IS_NOT_EMPTY", condition: "" }],
      },
    },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const errs = json.data?.collectionCreate?.userErrors ?? [];
  if (errs.length) throw new Error(errs.map((e: { message: string }) => e.message).join(", "));
  return json.data?.collectionCreate?.collection ?? null;
}

// ── Fetch distinct language values from product metafields ───────────────────

async function fetchLanguages(domain: string, token: string): Promise<string[]> {
  const langs = new Set<string>();
  let cursor: string | null = null;
  let pagesFetched = 0;
  const MAX_PAGES = 20; // cap at ~5000 products to avoid timeout

  const query = `
    query GetProductLanguages($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          metafield(namespace: "custom", key: "language") { value }
        }
      }
    }
  `;

  do {
    const res = await shopifyGQL(domain, token, query, { first: 250, after: cursor ?? undefined });
    if (!res.ok) break;
    const json = await res.json();
    const page = json.data?.products;
    if (!page) break;

    for (const p of page.nodes) {
      const v = p.metafield?.value?.trim();
      if (v) langs.add(v);
    }

    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    pagesFetched++;
  } while (cursor && pagesFetched < MAX_PAGES);

  return Array.from(langs).sort();
}

// ── Fetch all products in a collection ───────────────────────────────────────

interface CollectionProduct {
  id: string;
  title: string;
  handle: string;
  publishedAt: string | null;
  language: string | null;
  availableForSale: boolean;
  vendor: string | null;
}

async function fetchCollectionProducts(
  domain: string,
  token: string,
  collectionId: string,
): Promise<{ products: CollectionProduct[]; title: string }> {
  const products: CollectionProduct[] = [];
  let cursor: string | null = null;
  let collectionTitle = collectionId;
  let pagesFetched = 0;

  const query = `
    query GetCollectionProducts($id: ID!, $first: Int!, $after: String) {
      collection(id: $id) {
        title
        products(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id title handle publishedAt vendor
            metafield(namespace: "custom", key: "language") { value }
            variants(first: 1) { nodes { availableForSale } }
          }
        }
      }
    }
  `;

  do {
    const res = await shopifyGQL(domain, token, query, {
      id: collectionId,
      first: 250,
      after: cursor ?? undefined,
    });
    if (!res.ok) throw new Error(`Product fetch failed [${res.status}]`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors[0].message);

    const collection = json.data?.collection;
    if (!collection) throw new Error(`Collection ${collectionId} not found`);

    collectionTitle = collection.title;
    const page = collection.products;

    for (const p of page.nodes) {
      products.push({
        id: p.id,
        title: p.title,
        handle: p.handle,
        publishedAt: p.publishedAt ?? null,
        language: p.metafield?.value?.trim() || null,
        availableForSale: p.variants?.nodes?.[0]?.availableForSale ?? false,
        vendor: p.vendor?.trim() || null,
      });
    }

    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    pagesFetched++;
  } while (cursor && pagesFetched < COLLECTION_MAX_PAGES);

  return { products, title: collectionTitle };
}

// ── Sort logic ───────────────────────────────────────────────────────────────

interface SortRule {
  type: "language" | "stock" | "date" | "publisher";
  value: string;
  priority?: number;
}

function matchesLanguageRule(productLang: string | null, ruleLang: string): boolean {
  if (!productLang) return false;
  const p = productLang.toLowerCase().trim();
  const r = ruleLang.toLowerCase().trim();
  return p === r || p.includes(r) || r.includes(p);
}

function getLanguageGroup(
  language: string | null,
  languageRules: SortRule[],
): number {
  for (const rule of languageRules) {
    if (matchesLanguageRule(language, rule.value)) {
      return (rule.priority ?? 1) - 1;
    }
  }
  return languageRules.length; // "other languages" bucket
}

// Publisher priority tier, shared by every sort module — 0 when the product's
// vendor matches the selected publisher (or no filter is set), 1 otherwise.
// Always checked FIRST, ahead of language/stock/sales/etc., since the intent
// is "push this publisher's products to the top", not a tiebreaker.
function publisherRank(vendor: string | null, publisherFilter: string | null | undefined): number {
  if (!publisherFilter) return 0;
  return vendor && vendor.toLowerCase() === publisherFilter.toLowerCase() ? 0 : 1;
}

function sortProducts(products: CollectionProduct[], sortRules: SortRule[], publisherFilter?: string | null): CollectionProduct[] {
  const languageRules = sortRules
    .filter((r) => r.type === "language")
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  const stockRule = sortRules.find((r) => r.type === "stock");
  const dateRule = sortRules.find((r) => r.type === "date");

  const inStockFirst = !stockRule || stockRule.value === "in_stock_first";
  const newestFirst = !dateRule || dateRule.value === "newest_first";

  return [...products].sort((a, b) => {
    // 0. Publisher priority
    const pubA = publisherRank(a.vendor, publisherFilter);
    const pubB = publisherRank(b.vendor, publisherFilter);
    if (pubA !== pubB) return pubA - pubB;

    // 1. Language group
    const groupA = getLanguageGroup(a.language, languageRules);
    const groupB = getLanguageGroup(b.language, languageRules);
    if (groupA !== groupB) return groupA - groupB;

    // 2. Stock status
    if (a.availableForSale !== b.availableForSale) {
      if (inStockFirst) return a.availableForSale ? -1 : 1;
      return a.availableForSale ? 1 : -1;
    }

    // 3. Published date
    const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return newestFirst ? dateB - dateA : dateA - dateB;
  });
}

// ── Shopify mutations ────────────────────────────────────────────────────────

async function setCollectionManual(domain: string, token: string, collectionId: string): Promise<void> {
  const mutation = `
    mutation collectionUpdate($input: CollectionInput!) {
      collectionUpdate(input: $input) {
        collection { id sortOrder }
        userErrors { field message }
      }
    }
  `;
  const res = await shopifyGQL(domain, token, mutation, {
    input: { id: collectionId, sortOrder: "MANUAL" },
  });
  if (!res.ok) throw new Error(`Set manual sort failed [${res.status}]`);
  const json = await res.json();
  const errs = json.data?.collectionUpdate?.userErrors ?? [];
  if (errs.length) throw new Error(errs.map((e: { message: string }) => e.message).join(", "));
}

async function reorderCollectionProducts(
  domain: string,
  token: string,
  collectionId: string,
  productIds: string[],
): Promise<void> {
  if (productIds.length === 0) return;

  const BATCH = 250;
  const mutation = `
    mutation collectionReorderProducts($id: ID!, $moves: [MoveInput!]!) {
      collectionReorderProducts(id: $id, moves: $moves) {
        job { id }
        userErrors { field message }
      }
    }
  `;

  for (let i = 0; i < productIds.length; i += BATCH) {
    const moves = productIds.slice(i, i + BATCH).map((id, idx) => ({
      id,
      newPosition: String(i + idx),
    }));

    const res = await shopifyGQL(domain, token, mutation, { id: collectionId, moves });
    if (!res.ok) throw new Error(`Reorder failed [${res.status}]`);
    const json = await res.json();
    const errs = json.data?.collectionReorderProducts?.userErrors ?? [];
    if (errs.length) throw new Error(errs.map((e: { message: string }) => e.message).join(", "));

    if (i + BATCH < productIds.length) await sleep(500);
  }
}

// ── Extract numeric Shopify ID from GID ─────────────────────────────────────

function extractShopifyNumericId(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1];
}

// ── Fetch products with pricing for discount sort ────────────────────────────

interface CollectionProductWithPricing {
  id: string;
  title: string;
  price: number;
  compareAtPrice: number | null;
  availableForSale: boolean;
  vendor: string | null;
}

async function fetchCollectionProductsWithPricing(
  domain: string,
  token: string,
  collectionId: string,
): Promise<{ products: CollectionProductWithPricing[]; title: string }> {
  const products: CollectionProductWithPricing[] = [];
  let cursor: string | null = null;
  let collectionTitle = collectionId;
  let pagesFetched = 0;

  const query = `
    query GetCollectionProductsPricing($id: ID!, $first: Int!, $after: String) {
      collection(id: $id) {
        title
        products(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id title vendor
            variants(first: 1) { nodes { price compareAtPrice availableForSale } }
          }
        }
      }
    }
  `;

  do {
    const res = await shopifyGQL(domain, token, query, { id: collectionId, first: 250, after: cursor ?? undefined });
    if (!res.ok) throw new Error(`Product fetch failed [${res.status}]`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors[0].message);
    const collection = json.data?.collection;
    if (!collection) throw new Error(`Collection ${collectionId} not found`);
    collectionTitle = collection.title;
    for (const p of collection.products.nodes) {
      const v = p.variants?.nodes?.[0];
      products.push({
        id: p.id,
        title: p.title,
        price: parseFloat(v?.price ?? "0"),
        compareAtPrice: v?.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
        availableForSale: v?.availableForSale ?? false,
        vendor: p.vendor?.trim() || null,
      });
    }
    cursor = collection.products.pageInfo.hasNextPage ? collection.products.pageInfo.endCursor : null;
    pagesFetched++;
  } while (cursor && pagesFetched < COLLECTION_MAX_PAGES);

  return { products, title: collectionTitle };
}

// ── Fetch products with inventory quantity for inventory sort ─────────────────

interface CollectionProductWithInventory {
  id: string;
  title: string;
  inventoryQuantity: number;
  availableForSale: boolean;
  vendor: string | null;
}

async function fetchCollectionProductsWithInventory(
  domain: string,
  token: string,
  collectionId: string,
): Promise<{ products: CollectionProductWithInventory[]; title: string }> {
  const products: CollectionProductWithInventory[] = [];
  let cursor: string | null = null;
  let collectionTitle = collectionId;
  let pagesFetched = 0;

  const query = `
    query GetCollectionProductsInventory($id: ID!, $first: Int!, $after: String) {
      collection(id: $id) {
        title
        products(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id title vendor
            variants(first: 250) { nodes { inventoryQuantity availableForSale } }
          }
        }
      }
    }
  `;

  do {
    const res = await shopifyGQL(domain, token, query, { id: collectionId, first: 250, after: cursor ?? undefined });
    if (!res.ok) throw new Error(`Product fetch failed [${res.status}]`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors[0].message);
    const collection = json.data?.collection;
    if (!collection) throw new Error(`Collection ${collectionId} not found`);
    collectionTitle = collection.title;
    for (const p of collection.products.nodes) {
      const variantNodes = (p.variants?.nodes ?? []) as Array<{ inventoryQuantity: number | null; availableForSale: boolean }>;
      const totalQty = variantNodes.reduce((sum, v) => sum + (v.inventoryQuantity ?? 0), 0);
      const availableForSale = variantNodes.some((v) => v.availableForSale);
      products.push({ id: p.id, title: p.title, inventoryQuantity: totalQty, availableForSale, vendor: p.vendor?.trim() || null });
    }
    cursor = collection.products.pageInfo.hasNextPage ? collection.products.pageInfo.endCursor : null;
    pagesFetched++;
  } while (cursor && pagesFetched < COLLECTION_MAX_PAGES);

  return { products, title: collectionTitle };
}

// ── Sales data from Supabase ─────────────────────────────────────────────────

async function fetchSalesData(
  supabase: ReturnType<typeof createClient>,
  storeId: string,
  shopifyGids: string[],
  since?: string,
): Promise<Map<string, { orderCount: number; unitsSold: number; revenue: number }>> {
  // Use an RPC that does the join + aggregation server-side, scoped to this store.
  // Prior in-memory approach hit two bugs: PostgREST 1000-row default limit (truncated results)
  // and nginx 8KB URL limit (silent empty results when using .in() with large arrays).
  const numericIds = shopifyGids.map(extractShopifyNumericId);

  const { data: rows, error } = await supabase.rpc("get_store_sales_data", {
    p_store_id: storeId,
    p_numeric_product_ids: numericIds,
    p_since: since ?? null,
  });

  if (error) {
    console.error("[fetchSalesData] RPC error:", error.message);
    return new Map();
  }

  const result = new Map<string, { orderCount: number; unitsSold: number; revenue: number }>();
  for (const row of (rows ?? []) as Array<{ shopify_product_id: string; order_count: number; units_sold: number; revenue: number }>) {
    const gid = shopifyGids.find((g) => extractShopifyNumericId(g) === row.shopify_product_id);
    if (gid) {
      result.set(gid, {
        orderCount: Number(row.order_count),
        unitsSold:  Number(row.units_sold),
        revenue:    Number(row.revenue),
      });
    }
  }
  return result;
}

// ── Sort: discount ───────────────────────────────────────────────────────────

function sortProductsByDiscount(
  products: CollectionProductWithPricing[],
  sortRule: string,
  inStockFirst: boolean,
  publisherFilter?: string | null,
): CollectionProductWithPricing[] {
  return [...products].sort((a, b) => {
    const pubA = publisherRank(a.vendor, publisherFilter);
    const pubB = publisherRank(b.vendor, publisherFilter);
    if (pubA !== pubB) return pubA - pubB;

    // Stock tier: separate in-stock from out-of-stock first
    if (a.availableForSale !== b.availableForSale) {
      return inStockFirst
        ? (a.availableForSale ? -1 : 1)
        : (a.availableForSale ? 1 : -1);
    }
    const aDiscount = a.compareAtPrice !== null && a.compareAtPrice > a.price
      ? ((a.compareAtPrice - a.price) / a.compareAtPrice) * 100 : 0;
    const bDiscount = b.compareAtPrice !== null && b.compareAtPrice > b.price
      ? ((b.compareAtPrice - b.price) / b.compareAtPrice) * 100 : 0;
    if (sortRule === "discounted_first") {
      return (bDiscount > 0 ? 1 : 0) - (aDiscount > 0 ? 1 : 0);
    }
    // highest_discount_first
    return bDiscount - aDiscount;
  });
}

// ── Sort: inventory ──────────────────────────────────────────────────────────

function sortProductsByInventory(
  products: CollectionProductWithInventory[],
  sortRule: string,
  lowStockThreshold: number,
  overstockThreshold: number,
  inStockFirst: boolean,
  publisherFilter?: string | null,
): CollectionProductWithInventory[] {
  if (sortRule === "low_stock_first") {
    return [...products].sort((a, b) => {
      const pubA = publisherRank(a.vendor, publisherFilter);
      const pubB = publisherRank(b.vendor, publisherFilter);
      if (pubA !== pubB) return pubA - pubB;

      // Stock tier first
      if (a.availableForSale !== b.availableForSale) {
        return inStockFirst
          ? (a.availableForSale ? -1 : 1)
          : (a.availableForSale ? 1 : -1);
      }
      const aLow = a.inventoryQuantity > 0 && a.inventoryQuantity < lowStockThreshold ? 1 : 0;
      const bLow = b.inventoryQuantity > 0 && b.inventoryQuantity < lowStockThreshold ? 1 : 0;
      if (aLow !== bLow) return bLow - aLow;
      return a.inventoryQuantity - b.inventoryQuantity;
    });
  }
  // overstock_first
  return [...products].sort((a, b) => {
    const pubA = publisherRank(a.vendor, publisherFilter);
    const pubB = publisherRank(b.vendor, publisherFilter);
    if (pubA !== pubB) return pubA - pubB;

    // Stock tier first
    if (a.availableForSale !== b.availableForSale) {
      return inStockFirst
        ? (a.availableForSale ? -1 : 1)
        : (a.availableForSale ? 1 : -1);
    }
    const aOver = a.inventoryQuantity > overstockThreshold ? 1 : 0;
    const bOver = b.inventoryQuantity > overstockThreshold ? 1 : 0;
    if (aOver !== bOver) return bOver - aOver;
    return b.inventoryQuantity - a.inventoryQuantity;
  });
}

// ── Shared streaming run helper ───────────────────────────────────────────────

type AnyProduct = { id: string; title: string };

async function runStreamingSort<T extends AnyProduct>(
  supabase: ReturnType<typeof createClient>,
  storeId: string,
  collections: string[],
  domain: string,
  token: string,
  fetchFn: (domain: string, token: string, id: string) => Promise<{ products: T[]; title: string }>,
  sortFn: (products: T[]) => T[],
  sortMetaEntries: unknown[],
): Promise<Response> {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  (async () => {
    let totalProductsReordered = 0;
    let collectionsSorted = 0;
    const errors: Array<{ collectionId: string; title: string; error: string }> = [];

    for (const collectionId of collections) {
      let collectionTitle = collectionId;
      const heartbeat = setInterval(() => {
        writer.write(encoder.encode(JSON.stringify({ type: "heartbeat", collectionId }) + "\n")).catch(() => {});
      }, HEARTBEAT_INTERVAL_MS);

      try {
        // Watchdog: a single stalled/rate-limited collection must not block the whole run.
        const products = await Promise.race([
          (async () => {
            const { products, title } = await fetchFn(domain, token, collectionId);
            collectionTitle = title;
            const sorted = sortFn(products);
            const productIds = sorted.map((p) => p.id);
            await setCollectionManual(domain, token, collectionId);
            await reorderCollectionProducts(domain, token, collectionId, productIds);
            return products;
          })(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timed out after ${COLLECTION_TIMEOUT_MS / 1000}s`)), COLLECTION_TIMEOUT_MS)
          ),
        ]);
        totalProductsReordered += products.length;
        collectionsSorted++;
        await writer.write(encoder.encode(JSON.stringify({ collectionId, title: collectionTitle, status: "done", productsReordered: products.length }) + "\n"));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ collectionId, title: collectionTitle, error: msg });
        await writer.write(encoder.encode(JSON.stringify({ collectionId, title: collectionTitle, status: "failed", error: msg }) + "\n"));
      } finally {
        clearInterval(heartbeat);
      }
      await sleep(500);
    }

    try {
      await supabase.from("collection_sort_runs").insert({
        store_id: storeId,
        run_at: new Date().toISOString(),
        collections_sorted: collectionsSorted,
        products_reordered: totalProductsReordered,
        errors,
        sort_rules: sortMetaEntries,
        collection_scope: collections,
      });
    } catch (e) {
      console.error("Failed to save run log:", e);
    }

    await writer.write(encoder.encode(JSON.stringify({ type: "summary", collectionsTotal: collections.length, collectionsSorted, totalProductsReordered, errors, runAt: new Date().toISOString() }) + "\n"));
    await writer.close();
  })();

  return new Response(readable, {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { action, storeId, collections, sortRules, sortRule, lowStockThreshold, overstockThreshold, inStockFirst, salesWindowDays, publisherFilter } = body as {
    action: string;
    storeId: string;
    collections?: string[];
    sortRules?: SortRule[];
    publisherFilter?: string | null;
    sortRule?: string;
    lowStockThreshold?: number;
    overstockThreshold?: number;
    inStockFirst?: boolean;
    salesWindowDays?: number;
  };

  if (!storeId) {
    return new Response(JSON.stringify({ error: "storeId is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const conn = await getConnection(supabase, storeId);
  if (!conn?.access_token) {
    return new Response(
      JSON.stringify({ error: "No active Shopify connection for this store" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const domain = normalizeDomain(conn.shop_domain);

  // ── GET COLLECTIONS ──────────────────────────────────────────────────────
  if (action === "get_collections") {
    try {
      const cols = await fetchAllCollections(domain, conn.access_token);
      return new Response(JSON.stringify({ ok: true, collections: cols }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ ok: false, error: msg }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // ── CREATE ALL-PRODUCTS COLLECTION ──────────────────────────────────────
  if (action === "create_all_collection") {
    try {
      const col = await createAllProductsCollection(domain, conn.access_token);
      if (!col) throw new Error("Shopify did not return a collection — handle 'all' may be reserved on this store.");
      return new Response(JSON.stringify({ ok: true, collection: col }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ ok: false, error: msg }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // ── GET LANGUAGES ────────────────────────────────────────────────────────
  if (action === "get_languages") {
    try {
      const langs = await fetchLanguages(domain, conn.access_token);
      return new Response(JSON.stringify({ ok: true, languages: langs }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ ok: false, error: msg }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // ── RUN SORT (streaming NDJSON) ──────────────────────────────────────────
  if (action === "run_sort") {
    if (!collections?.length || !sortRules?.length) {
      return new Response(JSON.stringify({ error: "collections and sortRules are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return runStreamingSort(
      supabase, storeId, collections, domain, conn.access_token,
      fetchCollectionProducts,
      (products) => sortProducts(products, sortRules, publisherFilter),
      publisherFilter ? [...sortRules, { type: "publisher", value: publisherFilter }] : sortRules,
    );
  }

  // ── RUN SALES SORT ──────────────────────────────────────────────────────────
  if (action === "run_sales_sort") {
    if (!collections?.length) {
      return new Response(JSON.stringify({ error: "collections is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const rule = sortRule ?? "best_selling_first";
    const windowDays = salesWindowDays && salesWindowDays > 0 ? salesWindowDays : 30;
    const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

    // Pre-fetch all product GIDs across every selected collection so we can
    // build the sales data map before the streaming sort loop begins. Cache the
    // fetched products so the streaming loop below reuses them instead of
    // hitting Shopify a second time per collection.
    const productCache = new Map<string, { products: CollectionProduct[]; title: string }>();
    const allProductGids: string[] = [];
    for (const collectionId of collections) {
      try {
        const result = await fetchCollectionProducts(domain, conn.access_token, collectionId);
        productCache.set(collectionId, result);
        allProductGids.push(...result.products.map((p) => p.id));
      } catch {
        // If one collection fails here we still proceed; the streaming loop's
        // own fetch (cache miss) will retry it, and any failure is recorded there.
      }
    }
    const salesData = await fetchSalesData(supabase, storeId, allProductGids, since);
    console.log(`[sales-sort] salesData size=${salesData.size}, top5=`, JSON.stringify(
      [...salesData.entries()]
        .sort((a, b) => b[1].orderCount - a[1].orderCount)
        .slice(0, 5)
        .map(([gid, s]) => ({ gid, ...s }))
    ));

    const stockFirst = inStockFirst !== false; // default true
    return runStreamingSort(
      supabase, storeId, collections, domain, conn.access_token,
      (d, t, id) => {
        const cached = productCache.get(id);
        if (cached) return Promise.resolve(cached);
        return fetchCollectionProducts(d, t, id); // cache miss — pre-fetch failed, retry here
      },
      (products) => {
        const sorted = [...products].sort((a, b) => {
          const pubA = publisherRank(a.vendor, publisherFilter);
          const pubB = publisherRank(b.vendor, publisherFilter);
          if (pubA !== pubB) return pubA - pubB;

          // Stock tier first
          if (a.availableForSale !== b.availableForSale) {
            return stockFirst
              ? (a.availableForSale ? -1 : 1)
              : (a.availableForSale ? 1 : -1);
          }
          const aStats = salesData.get(a.id) ?? { orderCount: 0, unitsSold: 0, revenue: 0 };
          const bStats = salesData.get(b.id) ?? { orderCount: 0, unitsSold: 0, revenue: 0 };
          if (rule === "revenue_first")    return bStats.revenue    - aStats.revenue;
          if (rule === "units_sold_first") return bStats.unitsSold  - aStats.unitsSold;
          return bStats.orderCount - aStats.orderCount;
        });
        // Log top 3 for first collection to verify scoring
        console.log(`[sales-sort] top3 for collection=`, JSON.stringify(
          sorted.slice(0, 3).map(p => ({
            id: p.id,
            score: (salesData.get(p.id) ?? { orderCount: 0 }).orderCount,
          }))
        ));
        return sorted;
      },
      [{ type: rule, salesWindowDays: windowDays, inStockFirst: stockFirst, publisherFilter: publisherFilter ?? null }],
    );
  }

  // ── RUN DISCOUNT SORT ────────────────────────────────────────────────────────
  if (action === "run_discount_sort") {
    if (!collections?.length) {
      return new Response(JSON.stringify({ error: "collections is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const rule = sortRule ?? "discounted_first";

    return runStreamingSort(
      supabase, storeId, collections, domain, conn.access_token,
      fetchCollectionProductsWithPricing,
      (products) => sortProductsByDiscount(products, rule, inStockFirst !== false, publisherFilter),
      [{ type: rule, inStockFirst: inStockFirst !== false, publisherFilter: publisherFilter ?? null }],
    );
  }

  // ── RUN INVENTORY SORT ───────────────────────────────────────────────────────
  if (action === "run_inventory_sort") {
    if (!collections?.length) {
      return new Response(JSON.stringify({ error: "collections is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const rule = sortRule ?? "low_stock_first";
    const lowThreshold = lowStockThreshold ?? 5;
    const highThreshold = overstockThreshold ?? 50;

    return runStreamingSort(
      supabase, storeId, collections, domain, conn.access_token,
      fetchCollectionProductsWithInventory,
      (products) => sortProductsByInventory(products, rule, lowThreshold, highThreshold, inStockFirst !== false, publisherFilter),
      [{ type: rule, lowStockThreshold: lowThreshold, overstockThreshold: highThreshold, inStockFirst: inStockFirst !== false, publisherFilter: publisherFilter ?? null }],
    );
  }

  return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
