/**
 * shopify-seo-push — writes edited SEO / product fields back to Shopify Admin API
 * and updates the Supabase products table.
 *
 * POST body (single):
 *   { product_id: string, store_id: string, fields: { meta_title?, meta_description?, product_type? } }
 *
 * POST body (bulk):
 *   { bulk_updates: [{ product_id, store_id, fields }] }
 *
 * image_alt_text is saved only to Supabase (requires image GID for Shopify push).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GQL_VERSION   = "2024-01";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeDomain(d: string) {
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

const PRODUCT_UPDATE_MUTATION = `
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id }
      userErrors { field message }
    }
  }
`;

type PushFields = {
  meta_title?: string | null;
  meta_description?: string | null;
  image_alt_text?: string | null;
  product_type?: string | null;
};

type UpdateEntry = {
  product_id: string;  // Supabase UUID
  store_id: string;
  fields: PushFields;
};

async function pushToShopify(
  domain: string,
  token: string,
  shopifyProductId: string,
  fields: PushFields,
): Promise<{ ok: boolean; error?: string }> {
  const input: Record<string, unknown> = {
    id: `gid://shopify/Product/${shopifyProductId}`,
  };

  if ("meta_title" in fields || "meta_description" in fields) {
    input.seo = {
      title: fields.meta_title ?? undefined,
      description: fields.meta_description ?? undefined,
    };
  }
  if ("product_type" in fields && fields.product_type !== undefined) {
    input.productType = fields.product_type ?? "";
  }

  const hasShopifyFields = "seo" in input || "productType" in input;
  if (!hasShopifyFields) return { ok: true };

  try {
    const res = await fetch(`https://${domain}/admin/api/${GQL_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: PRODUCT_UPDATE_MUTATION, variables: { input } }),
    });

    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const gql = await res.json() as {
      data?: { productUpdate?: { userErrors?: { message: string }[] } };
      errors?: unknown[];
    };

    const userErrors = gql.data?.productUpdate?.userErrors ?? [];
    if (userErrors.length) return { ok: false, error: userErrors.map(e => e.message).join("; ") };
    if (gql.errors?.length) return { ok: false, error: JSON.stringify(gql.errors).slice(0, 200) };

    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function processUpdate(
  supabase: ReturnType<typeof createClient>,
  entry: UpdateEntry,
): Promise<{ product_id: string; ok: boolean; shopify_ok: boolean; error?: string }> {
  // Look up shopify_product_id + connection details in one query
  const { data: product } = await supabase
    .from("products")
    .select("shopify_product_id")
    .eq("id", entry.product_id)
    .single();

  const { data: conn } = await supabase
    .from("shopify_connections")
    .select("shop_domain, access_token")
    .eq("store_id", entry.store_id)
    .eq("is_active", true)
    .single();

  // Update Supabase (all fields including image_alt_text)
  const dbFields: Record<string, string | null> = {};
  if ("meta_title" in entry.fields) dbFields.meta_title = entry.fields.meta_title ?? null;
  if ("meta_description" in entry.fields) dbFields.meta_description = entry.fields.meta_description ?? null;
  if ("image_alt_text" in entry.fields) dbFields.image_alt_text = entry.fields.image_alt_text ?? null;
  if ("product_type" in entry.fields) dbFields.product_type = entry.fields.product_type ?? null;

  if (Object.keys(dbFields).length) {
    await supabase.from("products").update(dbFields).eq("id", entry.product_id);
  }

  // Push to Shopify (skip image_alt_text — no image GID available)
  if (!product?.shopify_product_id || !conn) {
    return { product_id: entry.product_id, ok: true, shopify_ok: false, error: "No Shopify connection found" };
  }

  const result = await pushToShopify(
    normalizeDomain(conn.shop_domain),
    conn.access_token,
    product.shopify_product_id,
    entry.fields,
  );

  return { product_id: entry.product_id, ok: true, shopify_ok: result.ok, error: result.error };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const body = await req.json().catch(() => ({})) as {
    product_id?: string;
    store_id?: string;
    fields?: PushFields;
    bulk_updates?: UpdateEntry[];
  };

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const updates: UpdateEntry[] = body.bulk_updates ?? (
    body.product_id && body.store_id
      ? [{ product_id: body.product_id, store_id: body.store_id, fields: body.fields ?? {} }]
      : []
  );

  if (!updates.length) return json(400, { error: "No updates provided" });

  const results = await Promise.all(updates.map(u => processUpdate(supabase, u)));

  return json(200, {
    updated: results.filter(r => r.ok).length,
    shopify_pushed: results.filter(r => r.shopify_ok).length,
    results,
  });
});
