/**
 * shopify-fetch-orders — fetches specific orders from Shopify by tracking number.
 * Use this to backfill individual missing orders without a full re-sync.
 *
 * POST body: { "tracking_numbers": ["22367826294616", "22364116295770"] }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Shopify GraphQL search by tracking number ──────────────────────────────────

async function findOrdersByTracking(
  domain: string,
  token: string,
  trackingNumbers: string[],
): Promise<unknown[]> {
  const found: unknown[] = [];

  for (const tn of trackingNumbers) {
    const query = `
      {
        orders(first: 5, query: "tracking_number:${tn}") {
          edges {
            node {
              id
              name
              email
              createdAt
              closedAt
              cancelledAt
              financialStatus
              fulfillmentStatus
              sourceName
              totalPriceSet { shopMoney { amount } }
              totalDiscountsSet { shopMoney { amount } }
              referringSite
              landingSiteBaseUrl
              customer {
                id
                createdAt
                email
              }
              discountCodes { code amount type }
              fulfillments {
                trackingInfo { number }
              }
            }
          }
        }
      }
    `;

    const res = await fetch(`https://${domain}/admin/api/2024-01/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      console.error(`GraphQL request failed for ${tn}: ${res.status}`);
      continue;
    }

    const json = await res.json() as { data?: { orders?: { edges?: { node: unknown }[] } } };
    const edges = json.data?.orders?.edges ?? [];
    for (const edge of edges) {
      found.push(edge.node);
    }
  }

  return found;
}

// ── Map GraphQL node → orders row ─────────────────────────────────────────────

function mapOrder(node: Record<string, unknown>, storeId: string): Record<string, unknown> {
  const fulfillments = (node.fulfillments as { trackingInfo?: { number?: string }[] }[]) ?? [];
  const trackingNumber =
    fulfillments[0]?.trackingInfo?.[0]?.number ??
    null;

  const customer = node.customer as Record<string, unknown> | null;
  const discountCodes = node.discountCodes as unknown[] | null;

  return {
    order_number:         String(node.name ?? node.id),
    shopify_order_id:     String((node.id as string).replace("gid://shopify/Order/", "")),
    store_id:             storeId,
    financial_status:     node.financialStatus ? String(node.financialStatus).toLowerCase() : null,
    fulfillment_status:   node.fulfillmentStatus ? String(node.fulfillmentStatus).toLowerCase() : null,
    order_status:         node.cancelledAt ? "cancelled" : node.closedAt ? "closed" : "open",
    shopify_created_at:   node.createdAt ?? null,
    closed_at:            node.closedAt ?? null,
    cancelled_at:         node.cancelledAt ?? null,
    source_name:          node.sourceName ?? null,
    customer_email:       node.email ?? customer?.email ?? null,
    shopify_customer_id:  customer?.id ? String((customer.id as string).replace("gid://shopify/Customer/", "")) : null,
    customer_first_order_at: customer?.createdAt ?? null,
    total_price:          node.totalPriceSet
      ? Number((node.totalPriceSet as Record<string, Record<string, string>>).shopMoney.amount)
      : null,
    total_discounts:      node.totalDiscountsSet
      ? Number((node.totalDiscountsSet as Record<string, Record<string, string>>).shopMoney.amount)
      : null,
    discount_codes:       discountCodes?.length ? discountCodes : null,
    referring_site:       node.referringSite ?? null,
    landing_site:         node.landingSiteBaseUrl ?? null,
    tracking_number:      trackingNumber,
    status:               (node.financialStatus as string | null) ?? (node.fulfillmentStatus as string | null) ?? "unknown",
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({})) as { tracking_numbers?: string[] };
  const trackingNumbers = body.tracking_numbers ?? [];

  if (!trackingNumbers.length) {
    return new Response(JSON.stringify({ error: "tracking_numbers array required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Get all active store connections
  const { data: connections, error: connErr } = await supabase
    .from("shopify_connections")
    .select("id, shop_domain, access_token, store_id")
    .eq("is_active", true);

  if (connErr || !connections?.length) {
    return new Response(JSON.stringify({ error: "No active connections", detail: connErr?.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Record<string, unknown>[] = [];
  let totalUpserted = 0;

  for (const conn of connections) {
    const domain = conn.shop_domain.trim().toLowerCase()
      .replace(/^https?:\/\//, "").replace(/\/+$/, "");

    const nodes = await findOrdersByTracking(domain, conn.access_token, trackingNumbers);

    for (const node of nodes) {
      const row = mapOrder(node as Record<string, unknown>, conn.store_id);

      // Only upsert if tracking number matches what we searched for
      if (!row.tracking_number || !trackingNumbers.includes(row.tracking_number as string)) {
        console.warn(`Skipping order ${row.order_number} — tracking ${row.tracking_number} not in target list`);
        continue;
      }

      const { data: existing, error: findErr } = await supabase
        .from("orders")
        .select("id")
        .eq("store_id", conn.store_id)
        .eq("shopify_order_id", row.shopify_order_id)
        .maybeSingle();

      const write = existing?.id
        ? await supabase.from("orders").update(row).eq("id", existing.id)
        : await supabase.from("orders").insert(row);

      const writeErr = findErr ?? write.error;
      if (writeErr) {
        console.error(`Upsert failed for ${row.order_number}:`, writeErr.message);
        results.push({ order_number: row.order_number, tracking_number: row.tracking_number, ok: false, error: writeErr.message });
      } else {
        totalUpserted++;
        results.push({ order_number: row.order_number, tracking_number: row.tracking_number, ok: true });
      }
    }
  }

  return new Response(
    JSON.stringify({ upserted: totalUpserted, results }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
