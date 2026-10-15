// Bundle Stock Check — public, read-only endpoint called from theme JS (the cart-level
// oversell guard) right before a bundle/component add-to-cart request. Given a shop domain
// and a list of real component ProductVariant numeric IDs, returns each one's live
// available inventory + title, so the browser can block an add BEFORE it reaches checkout
// instead of relying solely on the checkout-time Cart Transform Function.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

async function getConnectionByShopDomain(
  supabase: ReturnType<typeof createClient>,
  domain: string,
): Promise<{ shop_domain: string; access_token: string } | null> {
  // The caller (theme JS) always sends {{ shop.permanent_domain }} — the *.myshopify.com
  // domain, which Liquid can render regardless of which custom domain the storefront is
  // actually served on. That's what shop_domain is keyed by here, so no separate
  // custom-domain mapping table is needed.
  const norm = normalizeDomain(domain);
  const { data } = await supabase
    .from("shopify_connections")
    .select("shop_domain, access_token")
    .eq("is_active", true);
  if (!data) return null;
  const match = (data as any[]).find((c) => normalizeDomain(c.shop_domain) === norm);
  return match ? { shop_domain: match.shop_domain, access_token: match.access_token } : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { shop_domain, variant_ids } = await req.json();
    if (!shop_domain || !Array.isArray(variant_ids) || variant_ids.length === 0) {
      return new Response(JSON.stringify({ error: "shop_domain and variant_ids[] required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Hard cap — this only ever checks one bundle's worth of components at a time.
    const ids = variant_ids.slice(0, 40).map((v: string | number) => String(v));

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const conn = await getConnectionByShopDomain(supabase, shop_domain);
    if (!conn) {
      return new Response(JSON.stringify({ error: "unknown shop_domain" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const gids = ids.map((id) => (id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id}`));
    const query = `
      query BundleStockCheck($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id
            inventoryPolicy
            product { title }
            inventoryItem {
              tracked
              inventoryLevels(first: 5) {
                nodes { quantities(names: ["available"]) { name quantity } }
              }
            }
          }
        }
      }
    `;
    const res = await fetch(`https://${conn.shop_domain}/admin/api/2024-01/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": conn.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { ids: gids } }),
    });
    const json = await res.json();
    if (json.errors) {
      return new Response(JSON.stringify({ error: "shopify_error", detail: json.errors }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result: Record<string, { available: number; title: string; tracked: boolean; policy: string }> = {};
    (json.data?.nodes ?? []).forEach((node: any, i: number) => {
      if (!node) return;
      const numericId = gids[i].replace("gid://shopify/ProductVariant/", "");
      const available = node.inventoryItem?.inventoryLevels?.nodes?.reduce(
        (sum: number, lvl: any) => sum + (lvl.quantities?.find((q: any) => q.name === "available")?.quantity ?? 0),
        0,
      ) ?? 0;
      result[numericId] = {
        available,
        title: node.product?.title ?? "",
        tracked: !!node.inventoryItem?.tracked,
        policy: node.inventoryPolicy ?? "CONTINUE",
      };
    });

    return new Response(JSON.stringify({ stock: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
