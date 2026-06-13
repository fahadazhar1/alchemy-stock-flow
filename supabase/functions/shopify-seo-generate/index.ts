/**
 * shopify-seo-generate — generates SEO metadata using Claude AI.
 * Max 50 products per call; batched into groups of 10 for the API.
 *
 * POST body:
 *   { products: [{ product_id, product_name, collection_name?, product_type?, vendor_name? }] }
 *
 * Returns:
 *   { results: [{ product_id, meta_title, meta_description }] }
 */

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const CLAUDE_MODEL  = "claude-haiku-4-5-20251001";

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

type Product = {
  product_id: string;
  product_name: string;
  collection_name?: string | null;
  product_type?: string | null;
  vendor_name?: string | null;
};

type SEOResult = {
  product_id: string;
  meta_title: string;
  meta_description: string;
};

async function generateBatch(products: Product[]): Promise<SEOResult[]> {
  const prompt = `You generate SEO metadata for an Islamic books and publications store (Darussalam Publishers).

For each product return ONLY a JSON array — no markdown, no explanation, no extra text.
Schema: [{"product_id":"...","meta_title":"...","meta_description":"..."}]

Rules:
- meta_title: 50-60 characters. Include product name. Mention Darussalam or Islamic where natural.
- meta_description: 120-155 characters. Concise value proposition with a soft call-to-action.
- Never truncate mid-word. Never exceed the character limits.

Products:
${JSON.stringify(products)}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json() as { content?: { text: string }[] };
  const text = data.content?.[0]?.text ?? "";

  // Extract JSON array from response (strip any surrounding text)
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array in response");

  const parsed = JSON.parse(match[0]) as SEOResult[];
  return parsed.filter(r => r.product_id && r.meta_title && r.meta_description);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  if (!ANTHROPIC_KEY) return json(500, { error: "ANTHROPIC_API_KEY not configured" });

  const body = await req.json().catch(() => ({})) as { products?: Product[] };
  const products = (body.products ?? []).slice(0, 50);

  if (!products.length) return json(400, { error: "No products provided" });

  // Batch into groups of 10
  const BATCH = 10;
  const batches: Product[][] = [];
  for (let i = 0; i < products.length; i += BATCH) {
    batches.push(products.slice(i, i + BATCH));
  }

  const results: SEOResult[] = [];
  const errors: string[] = [];

  for (const batch of batches) {
    try {
      const batchResults = await generateBatch(batch);
      results.push(...batchResults);
    } catch (e) {
      errors.push((e as Error).message);
      console.error("Batch error:", (e as Error).message);
    }
  }

  return json(200, { results, errors: errors.length ? errors : undefined });
});
