// FBT Bundle Discount settings — read/update the per-store enable/percentage/dead-stock-filler
// controls for the "Frequently Bought Together" checkout discount (custom Shopify Function app),
// and report basic usage stats. Discount config lives in sharded DiscountAutomaticApp metafields
// (see project_fbt_bundle_discount_app.md) — this function fans out over every shard for a store.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Domain -> which Supabase secret holds that store's FBT app-installation token.
// Reserved-namespace ($app:) metafields and discountAutomaticApp* mutations are only
// visible/usable via the token of the app that owns them, not the store's general admin token.
const FBT_APP_TOKEN_ENV: Record<string, string> = {
  "1cnqfb-bf.myshopify.com": "FBT_APP_TOKEN_UK",
  "g2nxeh-hm.myshopify.com": "FBT_APP_TOKEN_PK",
  "hgty2t-hm.myshopify.com": "FBT_APP_TOKEN_KSA",
  "fxikrx-wy.myshopify.com": "FBT_APP_TOKEN_UAE",
};

function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function shopifyGQL(
  domain: string,
  token: string,
  apiVersion: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<any> {
  const url = `https://${domain}/admin/api/${apiVersion}/graphql.json`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) {
      const retry = Number(res.headers.get("Retry-After") ?? "2");
      await sleep(retry * 1000 * (attempt + 1));
      continue;
    }
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json;
  }
  throw new Error("Shopify GraphQL retries exhausted");
}

async function getConnection(supabase: ReturnType<typeof createClient>, connectionId: string) {
  const { data } = await supabase
    .from("shopify_connections")
    .select("shop_domain, access_token, store_id")
    .eq("id", connectionId)
    .eq("is_active", true)
    .single();
  return data as { shop_domain: string; access_token: string; store_id: string } | null;
}

function appTokenFor(domain: string): string {
  const envKey = FBT_APP_TOKEN_ENV[domain];
  if (!envKey) throw new Error(`No FBT app token configured for ${domain}`);
  const token = Deno.env.get(envKey);
  if (!token) throw new Error(`Missing secret ${envKey}`);
  return token;
}

// ── Discount shard helpers ────────────────────────────────────────────────

const SHARD_QUERY = `
query($cursor: String) {
  discountNodes(first: 100, after: $cursor, query: "title:Frequently Bought Together*") {
    pageInfo { hasNextPage endCursor }
    edges { node { id } }
  }
}`;

async function listShardIds(domain: string, appToken: string): Promise<string[]> {
  let cursor: string | null = null;
  const ids: string[] = [];
  while (true) {
    const d = await shopifyGQL(domain, appToken, "2024-01", SHARD_QUERY, { cursor });
    const page = d.data.discountNodes;
    for (const e of page.edges) ids.push(e.node.id);
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }
  return ids;
}

const METAFIELD_READ_QUERY = `
query($id: ID!) { discountNode(id: $id) { metafields(first: 5) { nodes { value } } } }`;

async function readShardConfig(domain: string, appToken: string, discountId: string) {
  const d = await shopifyGQL(domain, appToken, "2025-10", METAFIELD_READ_QUERY, { id: discountId });
  const raw = d.data.discountNode?.metafields?.nodes?.[0]?.value;
  if (!raw) return { enabled: true, percentage: 10, trios: [] };
  return JSON.parse(raw);
}

const METAFIELD_SET_MUTATION = `
mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message code } }
}`;

async function writeShardConfig(domain: string, appToken: string, discountId: string, config: unknown) {
  const value = JSON.stringify(config);
  const d = await shopifyGQL(domain, appToken, "2025-10", METAFIELD_SET_MUTATION, {
    metafields: [
      { ownerId: discountId, namespace: "$app:fbt-bundle-discount", key: "function-configuration", type: "json", value },
    ],
  });
  const errs = d.data.metafieldsSet.userErrors;
  if (errs.length) throw new Error(JSON.stringify(errs));
}

// ── Shop-level dead-stock-filler toggle ──────────────────────────────────

const SHOP_ID_QUERY = `query { shop { id } }`;
const SHOP_METAFIELD_QUERY = `
query { shop { metafield(namespace: "darussalam", key: "fbt_show_deadstock") { value } } }`;

async function readShowDeadstock(domain: string, adminToken: string): Promise<boolean> {
  const d = await shopifyGQL(domain, adminToken, "2024-01", SHOP_METAFIELD_QUERY, {});
  const raw = d.data.shop?.metafield?.value;
  if (raw === undefined || raw === null) return true;
  return raw !== "false";
}

async function writeShowDeadstock(domain: string, adminToken: string, show: boolean) {
  const shopData = await shopifyGQL(domain, adminToken, "2024-01", SHOP_ID_QUERY, {});
  const shopId = shopData.data.shop.id;
  const d = await shopifyGQL(domain, adminToken, "2024-01", METAFIELD_SET_MUTATION, {
    metafields: [
      { ownerId: shopId, namespace: "darussalam", key: "fbt_show_deadstock", type: "boolean", value: show ? "true" : "false" },
    ],
  });
  const errs = d.data.metafieldsSet.userErrors;
  if (errs.length) throw new Error(JSON.stringify(errs));
}

// Shop-level mirror of the discount's enabled/percentage, purely so the storefront FBT
// widget can show "Save X%" messaging without needing to call the discount API itself.
async function writeDiscountVisibility(domain: string, adminToken: string, enabled: boolean, percentage: number) {
  const shopData = await shopifyGQL(domain, adminToken, "2024-01", SHOP_ID_QUERY, {});
  const shopId = shopData.data.shop.id;
  const d = await shopifyGQL(domain, adminToken, "2024-01", METAFIELD_SET_MUTATION, {
    metafields: [
      { ownerId: shopId, namespace: "darussalam", key: "fbt_discount_enabled", type: "boolean", value: enabled ? "true" : "false" },
      { ownerId: shopId, namespace: "darussalam", key: "fbt_discount_percentage", type: "number_integer", value: String(percentage) },
    ],
  });
  const errs = d.data.metafieldsSet.userErrors;
  if (errs.length) throw new Error(JSON.stringify(errs));
}

// ── Usage stats (queries live Shopify orders, not Supabase — no egress concern) ──

const ORDERS_QUERY = `
query($cursor: String, $queryString: String!) {
  orders(first: 100, after: $cursor, query: $queryString) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        currentTotalPriceSet { shopMoney { amount } }
        totalDiscountsSet { shopMoney { amount } }
        discountApplications(first: 5) {
          nodes {
            __typename
            ... on AutomaticDiscountApplication { title }
          }
        }
      }
    }
  }
}`;

async function getStats(domain: string, adminToken: string, days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const queryString = `created_at:>=${since}`;
  let cursor: string | null = null;
  let ordersScanned = 0;
  let matchingOrders = 0;
  let totalDiscountGiven = 0;
  let totalRevenue = 0;

  while (true) {
    const d = await shopifyGQL(domain, adminToken, "2024-01", ORDERS_QUERY, { cursor, queryString });
    const page = d.data.orders;
    for (const e of page.edges) {
      ordersScanned++;
      const applications = e.node.discountApplications?.nodes ?? [];
      const matched = applications.some(
        (a: any) => a.__typename === "AutomaticDiscountApplication" && a.title?.startsWith("Frequently Bought Together"),
      );
      if (matched) {
        matchingOrders++;
        totalDiscountGiven += parseFloat(e.node.totalDiscountsSet?.shopMoney?.amount ?? "0");
        totalRevenue += parseFloat(e.node.currentTotalPriceSet?.shopMoney?.amount ?? "0");
      }
    }
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
    if (ordersScanned > 5000) break; // safety cap
  }

  return {
    days,
    ordersScanned,
    matchingOrders,
    totalDiscountGiven: Math.round(totalDiscountGiven * 100) / 100,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
  };
}

// ── Main handler ─────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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

  const { action, connection_id } = body as { action: string; connection_id: string };

  try {
    const conn = await getConnection(supabase, connection_id);
    if (!conn?.access_token) throw new Error("No active Shopify connection for this store");
    const domain = normalizeDomain(conn.shop_domain);

    if (action === "get_settings") {
      const appToken = appTokenFor(domain);
      const shardIds = await listShardIds(domain, appToken);
      const firstConfig = shardIds.length > 0 ? await readShardConfig(domain, appToken, shardIds[0]) : { enabled: true, percentage: 10 };
      const showDeadstock = await readShowDeadstock(domain, conn.access_token);
      return new Response(
        JSON.stringify({
          ok: true,
          enabled: firstConfig.enabled ?? true,
          percentage: firstConfig.percentage ?? 10,
          showDeadstock,
          shardCount: shardIds.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "update_settings") {
      const { enabled, percentage, showDeadstock } = body as { enabled: boolean; percentage: number; showDeadstock: boolean };
      const appToken = appTokenFor(domain);
      const shardIds = await listShardIds(domain, appToken);
      let updated = 0;
      for (const id of shardIds) {
        const current = await readShardConfig(domain, appToken, id);
        await writeShardConfig(domain, appToken, id, { ...current, enabled, percentage });
        updated++;
      }
      await writeShowDeadstock(domain, conn.access_token, showDeadstock);
      await writeDiscountVisibility(domain, conn.access_token, enabled, percentage);
      return new Response(JSON.stringify({ ok: true, shardsUpdated: updated }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get_stats") {
      const days = (body.days as number) ?? 90;
      const stats = await getStats(domain, conn.access_token, days);
      return new Response(JSON.stringify({ ok: true, ...stats }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
