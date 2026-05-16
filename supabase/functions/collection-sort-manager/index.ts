// Collection Sort Manager — sorts Shopify collection products by language, stock, and date
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

  return all;
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
}

async function fetchCollectionProducts(
  domain: string,
  token: string,
  collectionId: string,
): Promise<{ products: CollectionProduct[]; title: string }> {
  const products: CollectionProduct[] = [];
  let cursor: string | null = null;
  let collectionTitle = collectionId;

  const query = `
    query GetCollectionProducts($id: ID!, $first: Int!, $after: String) {
      collection(id: $id) {
        title
        products(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id title handle publishedAt
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
      });
    }

    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  return { products, title: collectionTitle };
}

// ── Sort logic ───────────────────────────────────────────────────────────────

interface SortRule {
  type: "language" | "stock" | "date";
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

function sortProducts(products: CollectionProduct[], sortRules: SortRule[]): CollectionProduct[] {
  const languageRules = sortRules
    .filter((r) => r.type === "language")
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  const stockRule = sortRules.find((r) => r.type === "stock");
  const dateRule = sortRules.find((r) => r.type === "date");

  const inStockFirst = !stockRule || stockRule.value === "in_stock_first";
  const newestFirst = !dateRule || dateRule.value === "newest_first";

  return [...products].sort((a, b) => {
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

  const { action, storeId, collections, sortRules } = body as {
    action: string;
    storeId: string;
    collections?: string[];
    sortRules?: SortRule[];
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

    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();

    (async () => {
      let totalProductsReordered = 0;
      let collectionsSorted = 0;
      const errors: Array<{ collectionId: string; title: string; error: string }> = [];

      for (const collectionId of collections) {
        let collectionTitle = collectionId;
        try {
          const { products, title } = await fetchCollectionProducts(domain, conn.access_token, collectionId);
          collectionTitle = title;

          const sorted = sortProducts(products, sortRules);
          const productIds = sorted.map((p) => p.id);

          await setCollectionManual(domain, conn.access_token, collectionId);
          await reorderCollectionProducts(domain, conn.access_token, collectionId, productIds);

          totalProductsReordered += products.length;
          collectionsSorted++;

          await writer.write(
            encoder.encode(
              JSON.stringify({
                collectionId,
                title,
                status: "done",
                productsReordered: products.length,
              }) + "\n",
            ),
          );
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push({ collectionId, title: collectionTitle, error: msg });

          await writer.write(
            encoder.encode(
              JSON.stringify({
                collectionId,
                title: collectionTitle,
                status: "failed",
                error: msg,
              }) + "\n",
            ),
          );
        }

        // Respect Shopify rate limits between collections
        await sleep(500);
      }

      // Persist run log
      try {
        await supabase.from("collection_sort_runs").insert({
          store_id: storeId,
          run_at: new Date().toISOString(),
          collections_sorted: collectionsSorted,
          products_reordered: totalProductsReordered,
          errors,
          sort_rules: sortRules,
          collection_scope: collections,
        });
      } catch (e) {
        console.error("Failed to save run log:", e);
      }

      // Final summary line
      await writer.write(
        encoder.encode(
          JSON.stringify({
            type: "summary",
            collectionsTotal: collections.length,
            collectionsSorted,
            totalProductsReordered,
            errors,
            runAt: new Date().toISOString(),
          }) + "\n",
        ),
      );

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

  return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
