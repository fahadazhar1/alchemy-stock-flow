// Bundle Builder — creates/updates/archives Shopify bundle products (product + metafields)
// so the team can build bundles from the dashboard without touching Liquid templates.
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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

async function getConnection(supabase: ReturnType<typeof createClient>, connectionId: string) {
  const { data } = await supabase
    .from("shopify_connections")
    .select("shop_domain, access_token, store_id")
    .eq("id", connectionId)
    .eq("is_active", true)
    .single();
  return data as { shop_domain: string; access_token: string; store_id: string } | null;
}

function toProductGid(shopifyProductId: string): string {
  return `gid://shopify/Product/${shopifyProductId}`;
}

async function publishToOnlineStore(domain: string, token: string, productGid: string): Promise<void> {
  const pubQuery = `query { publications(first: 10) { nodes { id name } } }`;
  const pubRes = await shopifyGQL(domain, token, pubQuery);
  if (!pubRes.ok) return;
  const pubJson = await pubRes.json();
  const onlineStore = (pubJson.data?.publications?.nodes ?? []).find(
    (p: { id: string; name: string }) => p.name === "Online Store",
  );
  if (!onlineStore) return;

  const publishMutation = `
    mutation bundlePublishablePublish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        userErrors { field message }
      }
    }
  `;
  await shopifyGQL(domain, token, publishMutation, {
    id: productGid,
    input: [{ publicationId: onlineStore.id }],
  });
}

// ── Book lookup (local Postgres, not Shopify) ────────────────────────────────

interface BookRow {
  id: string;
  name: string;
  shopify_product_id: string | null;
  price: number;
}

async function fetchBooks(
  supabase: ReturnType<typeof createClient>,
  bookIds: string[],
): Promise<BookRow[]> {
  const { data: products, error: pErr } = await supabase
    .from("products")
    .select("id, name, shopify_product_id")
    .in("id", bookIds);
  if (pErr) throw new Error(pErr.message);

  const { data: variants, error: vErr } = await supabase
    .from("variants")
    .select("product_id, price")
    .in("product_id", bookIds);
  if (vErr) throw new Error(vErr.message);

  const priceByProduct = new Map<string, number>();
  for (const v of (variants ?? []) as Array<{ product_id: string; price: number }>) {
    if (!priceByProduct.has(v.product_id)) priceByProduct.set(v.product_id, Number(v.price));
  }

  const rows = (products ?? []) as Array<{ id: string; name: string; shopify_product_id: string | null }>;
  // Preserve the order the caller picked the books in.
  return bookIds
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is { id: string; name: string; shopify_product_id: string | null } => !!r)
    .map((r) => ({
      id: r.id,
      name: r.name,
      shopify_product_id: r.shopify_product_id,
      price: priceByProduct.get(r.id) ?? 0,
    }));
}

function buildBundleMetafields(
  bookGids: string[],
  badgeText: string | undefined,
  subtitle: string | undefined,
  titleOverride: string | undefined,
) {
  const metafields: Array<{ namespace: string; key: string; type: string; value: string }> = [
    { namespace: "bundle", key: "books", type: "list.product_reference", value: JSON.stringify(bookGids) },
  ];
  if (badgeText) metafields.push({ namespace: "bundle", key: "badge_text", type: "single_line_text_field", value: badgeText });
  if (subtitle) metafields.push({ namespace: "bundle", key: "subtitle", type: "single_line_text_field", value: subtitle });
  if (titleOverride) metafields.push({ namespace: "bundle", key: "title_override", type: "single_line_text_field", value: titleOverride });
  return metafields;
}

// ── create_bundle ─────────────────────────────────────────────────────────────

async function createBundle(
  supabase: ReturnType<typeof createClient>,
  domain: string,
  token: string,
  body: {
    connection_id: string;
    store_id: string;
    title: string;
    price: number;
    badge_text?: string;
    subtitle?: string;
    title_override?: string;
    book_ids: string[];
  },
) {
  const books = await fetchBooks(supabase, body.book_ids);
  const missing = books.filter((b) => !b.shopify_product_id);
  if (missing.length) {
    throw new Error(`These books have no Shopify product linked yet: ${missing.map((b) => b.name).join(", ")}`);
  }

  const individualTotal = books.reduce((sum, b) => sum + b.price, 0);
  const bookGids = books.map((b) => toProductGid(b.shopify_product_id!));

  const createMutation = `
    mutation bundleProductCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id
          handle
          templateSuffix
          variants(first: 1) { nodes { id } }
        }
        userErrors { field message }
      }
    }
  `;
  const createRes = await shopifyGQL(domain, token, createMutation, {
    product: {
      title: body.title,
      productType: "Bundle",
      status: "ACTIVE",
      tags: ["bundle", "free-shipping-bundle"],
      templateSuffix: "bundle-v2",
      metafields: buildBundleMetafields(bookGids, body.badge_text, body.subtitle, body.title_override),
    },
  });
  if (!createRes.ok) throw new Error(`productCreate failed [${createRes.status}]`);
  const createJson = await createRes.json();
  const createErrs = createJson.data?.productCreate?.userErrors ?? [];
  if (createErrs.length) throw new Error(createErrs.map((e: { message: string }) => e.message).join(", "));
  const product = createJson.data?.productCreate?.product;
  if (!product) throw new Error("Shopify did not return the created product");

  const variantId = product.variants?.nodes?.[0]?.id;
  if (!variantId) throw new Error("Shopify did not return the default variant");

  const variantMutation = `
    mutation bundleVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id price inventoryPolicy taxable }
        userErrors { field message }
      }
    }
  `;
  const variantRes = await shopifyGQL(domain, token, variantMutation, {
    productId: product.id,
    variants: [{
      id: variantId,
      price: body.price.toFixed(2),
      inventoryPolicy: "CONTINUE",
      taxable: false,
    }],
  });
  if (!variantRes.ok) throw new Error(`productVariantsBulkUpdate failed [${variantRes.status}]`);
  const variantJson = await variantRes.json();
  const variantErrs = variantJson.data?.productVariantsBulkUpdate?.userErrors ?? [];
  if (variantErrs.length) throw new Error(variantErrs.map((e: { message: string }) => e.message).join(", "));

  await publishToOnlineStore(domain, token, product.id);

  const numericProductId = product.id.split("/").pop()!;
  const numericVariantId = (variantId as string).split("/").pop()!;

  const { data: row, error: insertErr } = await supabase
    .from("bundles")
    .insert({
      store_id: body.store_id,
      shopify_product_id: numericProductId,
      shopify_variant_id: numericVariantId,
      handle: product.handle,
      title: body.title,
      price: body.price,
      badge_text: body.badge_text ?? null,
      subtitle: body.subtitle ?? null,
      title_override: body.title_override ?? null,
      book_product_ids: body.book_ids,
    })
    .select()
    .single();
  if (insertErr) throw new Error(insertErr.message);

  const manualSteps = [
    "Add a Rs. 0 (or £0) shipping rate for this product in Shopify Admin → Settings → Shipping and delivery — the Admin API has no shipping-profile scope.",
  ];
  if (body.price > individualTotal) {
    manualSteps.push(
      `Heads up: bundle price (${body.price}) is higher than the individual total (${individualTotal}) — the storefront will show no savings badge.`,
    );
  }

  return { bundle: row, individualTotal, manualSteps };
}

// ── update_bundle ─────────────────────────────────────────────────────────────

async function updateBundle(
  supabase: ReturnType<typeof createClient>,
  domain: string,
  token: string,
  body: {
    bundle_id: string;
    title?: string;
    price?: number;
    badge_text?: string;
    subtitle?: string;
    title_override?: string;
    book_ids?: string[];
  },
) {
  const { data: existing, error: fetchErr } = await supabase
    .from("bundles")
    .select("*")
    .eq("id", body.bundle_id)
    .single();
  if (fetchErr || !existing) throw new Error("Bundle not found");

  const productGid = toProductGid(existing.shopify_product_id);
  const bookIds = body.book_ids ?? existing.book_product_ids;
  const books = await fetchBooks(supabase, bookIds);
  const missing = books.filter((b) => !b.shopify_product_id);
  if (missing.length) {
    throw new Error(`These books have no Shopify product linked yet: ${missing.map((b) => b.name).join(", ")}`);
  }
  const bookGids = books.map((b) => toProductGid(b.shopify_product_id!));

  const metafields = buildBundleMetafields(
    bookGids,
    body.badge_text ?? existing.badge_text ?? undefined,
    body.subtitle ?? existing.subtitle ?? undefined,
    body.title_override ?? existing.title_override ?? undefined,
  ).map((m) => ({ ...m, ownerId: productGid }));

  const setMutation = `
    mutation bundleMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key namespace value }
        userErrors { field message code }
      }
    }
  `;
  const setRes = await shopifyGQL(domain, token, setMutation, { metafields });
  if (!setRes.ok) throw new Error(`metafieldsSet failed [${setRes.status}]`);
  const setJson = await setRes.json();
  const setErrs = setJson.data?.metafieldsSet?.userErrors ?? [];
  if (setErrs.length) throw new Error(setErrs.map((e: { message: string }) => e.message).join(", "));

  if (body.title || body.price != null) {
    const updateMutation = `
      mutation bundleProductUpdate($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product { id }
          userErrors { field message }
        }
      }
    `;
    const updateInput: Record<string, unknown> = { id: productGid };
    if (body.title) updateInput.title = body.title;
    const updateRes = await shopifyGQL(domain, token, updateMutation, { product: updateInput });
    if (!updateRes.ok) throw new Error(`productUpdate failed [${updateRes.status}]`);
    const updateJson = await updateRes.json();
    const updateErrs = updateJson.data?.productUpdate?.userErrors ?? [];
    if (updateErrs.length) throw new Error(updateErrs.map((e: { message: string }) => e.message).join(", "));

    if (body.price != null) {
      const variantMutation = `
        mutation bundleVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            userErrors { field message }
          }
        }
      `;
      const variantRes = await shopifyGQL(domain, token, variantMutation, {
        productId: productGid,
        variants: [{ id: `gid://shopify/ProductVariant/${existing.shopify_variant_id}`, price: body.price.toFixed(2) }],
      });
      if (!variantRes.ok) throw new Error(`productVariantsBulkUpdate failed [${variantRes.status}]`);
      const variantJson = await variantRes.json();
      const variantErrs = variantJson.data?.productVariantsBulkUpdate?.userErrors ?? [];
      if (variantErrs.length) throw new Error(variantErrs.map((e: { message: string }) => e.message).join(", "));
    }
  }

  const { data: row, error: updateLocalErr } = await supabase
    .from("bundles")
    .update({
      title: body.title ?? existing.title,
      price: body.price ?? existing.price,
      badge_text: body.badge_text ?? existing.badge_text,
      subtitle: body.subtitle ?? existing.subtitle,
      title_override: body.title_override ?? existing.title_override,
      book_product_ids: bookIds,
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.bundle_id)
    .select()
    .single();
  if (updateLocalErr) throw new Error(updateLocalErr.message);

  return { bundle: row };
}

// ── archive_bundle ────────────────────────────────────────────────────────────

async function archiveBundle(
  supabase: ReturnType<typeof createClient>,
  domain: string,
  token: string,
  body: { bundle_id: string },
) {
  const { data: existing, error: fetchErr } = await supabase
    .from("bundles")
    .select("shopify_product_id")
    .eq("id", body.bundle_id)
    .single();
  if (fetchErr || !existing) throw new Error("Bundle not found");

  const mutation = `
    mutation bundleProductArchive($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { id status }
        userErrors { field message }
      }
    }
  `;
  const res = await shopifyGQL(domain, token, mutation, {
    product: { id: toProductGid(existing.shopify_product_id), status: "ARCHIVED" },
  });
  if (!res.ok) throw new Error(`productUpdate failed [${res.status}]`);
  const json = await res.json();
  const errs = json.data?.productUpdate?.userErrors ?? [];
  if (errs.length) throw new Error(errs.map((e: { message: string }) => e.message).join(", "));

  const { data: row, error: updateErr } = await supabase
    .from("bundles")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", body.bundle_id)
    .select()
    .single();
  if (updateErr) throw new Error(updateErr.message);

  return { bundle: row };
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

  const { action } = body as { action: string };

  try {
    if (action === "create_bundle") {
      const conn = await getConnection(supabase, body.connection_id as string);
      if (!conn?.access_token) throw new Error("No active Shopify connection for this store");
      const domain = normalizeDomain(conn.shop_domain);
      const result = await createBundle(supabase, domain, conn.access_token, body as any);
      return new Response(JSON.stringify({ ok: true, ...result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update_bundle") {
      const conn = await getConnection(supabase, body.connection_id as string);
      if (!conn?.access_token) throw new Error("No active Shopify connection for this store");
      const domain = normalizeDomain(conn.shop_domain);
      const result = await updateBundle(supabase, domain, conn.access_token, body as any);
      return new Response(JSON.stringify({ ok: true, ...result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "archive_bundle") {
      const conn = await getConnection(supabase, body.connection_id as string);
      if (!conn?.access_token) throw new Error("No active Shopify connection for this store");
      const domain = normalizeDomain(conn.shop_domain);
      const result = await archiveBundle(supabase, domain, conn.access_token, body as any);
      return new Response(JSON.stringify({ ok: true, ...result }), {
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