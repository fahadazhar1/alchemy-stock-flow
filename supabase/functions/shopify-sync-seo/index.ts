/**
 * shopify-sync-seo — fetches SEO fields (meta_title, meta_description, image_alt_text)
 * from Shopify GraphQL and writes them to the products table.
 * Broadcasts realtime progress to channel `seo-sync-{store_id}`.
 *
 * POST body: { store_id?: string }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY        = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdidmJ2b3BlaWVxZ2h2ZXR0bWtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MDMzNDksImV4cCI6MjA5MzI3OTM0OX0.bezMzljmBaqGo0kuThNO5tIuLDeWXaVnbAn8O2ZD5dM";
const GRAPHQL_VERSION = "2024-01";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizeDomain(d: string) {
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Broadcast progress via Supabase Realtime REST API
async function broadcast(channelTopic: string, processed: number, total: number) {
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
          topic: `realtime:${channelTopic}`,
          event: "broadcast",
          payload: { type: "broadcast", event: "progress", payload: { processed, total } },
        }],
      }),
    });
  } catch { /* non-critical */ }
}

// Get product count from Shopify REST
async function getProductCount(domain: string, token: string): Promise<number> {
  try {
    const res = await fetch(`https://${domain}/admin/api/${GRAPHQL_VERSION}/products/count.json`, {
      headers: { "X-Shopify-Access-Token": token },
    });
    if (!res.ok) return 0;
    const json = await res.json() as { count?: number };
    return json.count ?? 0;
  } catch { return 0; }
}

const SEO_QUERY = `
  query ProductSEO($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          seo { title description }
          featuredImage { altText }
          description
          variants(first: 1) { edges { node { barcode } } }
        }
      }
    }
  }
`;

async function syncSEOForConnection(
  supabase: ReturnType<typeof createClient>,
  domain: string,
  token: string,
  storeId: string,
): Promise<{ updated: number; errors: number }> {
  const channelTopic = `seo-sync-${storeId}`;
  const total = await getProductCount(domain, token);
  await broadcast(channelTopic, 0, total);

  let cursor: string | null = null;
  let processed = 0;
  let updated = 0;
  let errors = 0;

  do {
    // Fetch page of products from Shopify GraphQL
    const res = await fetch(`https://${domain}/admin/api/${GRAPHQL_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: SEO_QUERY, variables: { cursor } }),
    });

    if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const gqlJson = await res.json() as {
      data?: {
        products: {
          pageInfo: { hasNextPage: boolean; endCursor: string };
          edges: { node: {
            id: string;
            seo: { title: string | null; description: string | null };
            featuredImage: { altText: string | null } | null;
            description: string | null;
            variants: { edges: { node: { barcode: string | null } }[] } | null;
          } }[];
        };
      };
      errors?: unknown[];
    };

    if (gqlJson.errors?.length) throw new Error(`GraphQL: ${JSON.stringify(gqlJson.errors).slice(0, 300)}`);

    const { edges, pageInfo } = gqlJson.data!.products;

    // Concurrent DB updates within each page — much faster than sequential
    await Promise.all(edges.map(async ({ node }) => {
      const shopifyProductId = node.id.replace("gid://shopify/Product/", "");
      const bodyText = (node.description ?? "").trim();
      const { error } = await supabase
        .from("products")
        .update({
          meta_title:       node.seo?.title        || null,
          meta_description: node.seo?.description  || null,
          image_alt_text:   node.featuredImage?.altText || null,
          barcode:          node.variants?.edges?.[0]?.node?.barcode?.trim() || null,
          description_word_count: bodyText ? bodyText.split(/\s+/).length : 0,
        })
        .eq("shopify_product_id", shopifyProductId)
        .eq("store_id", storeId);

      if (error) errors++;
      else updated++;
    }));

    processed += edges.length;
    await broadcast(channelTopic, processed, total || processed);

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);

  // Final broadcast at 100%
  await broadcast(channelTopic, processed, processed);
  return { updated, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const body = await req.json().catch(() => ({})) as { store_id?: string };
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  let connQuery = supabase
    .from("shopify_connections")
    .select("id, shop_domain, access_token, store_id")
    .eq("is_active", true);

  if (body.store_id) {
    connQuery = connQuery.eq("store_id", body.store_id) as typeof connQuery;
  }

  const { data: connections, error: connErr } = await connQuery;
  if (connErr || !connections?.length) {
    return json(500, { error: "No active connections", detail: connErr?.message });
  }

  const results: Record<string, unknown>[] = [];
  let totalUpdated = 0;

  for (const conn of connections) {
    const domain = normalizeDomain(conn.shop_domain);
    try {
      const { updated, errors } = await syncSEOForConnection(supabase, domain, conn.access_token, conn.store_id);
      totalUpdated += updated;
      results.push({ store_id: conn.store_id, domain, updated, errors, ok: true });
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`SEO sync failed for ${domain}:`, msg);
      results.push({ store_id: conn.store_id, domain, ok: false, error: msg });
      return json(500, { error: msg, results });
    }
  }

  return json(200, { total_updated: totalUpdated, results });
});
