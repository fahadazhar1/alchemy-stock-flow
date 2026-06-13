import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type SEOFieldUpdate = {
  meta_title?: string | null;
  meta_description?: string | null;
  image_alt_text?: string | null;
  product_type?: string | null;
};

export type AIResult = {
  product_id: string;
  product_name: string;
  meta_title: string;
  meta_description: string;
};

function toDbFields(fields: SEOFieldUpdate): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if ("meta_title" in fields)       out.meta_title       = fields.meta_title       ?? null;
  if ("meta_description" in fields) out.meta_description = fields.meta_description ?? null;
  if ("image_alt_text" in fields)   out.image_alt_text   = fields.image_alt_text   ?? null;
  if ("product_type" in fields)     out.product_type     = fields.product_type     ?? null;
  return out;
}

export function useSEOActions(storeId: string | null) {
  const queryClient = useQueryClient();
  const [saving, setSaving]           = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["seo-audit"] });

  /** Save one product to DB + push SEO/productType to Shopify */
  const saveProduct = async (
    productId: string,
    fields: SEOFieldUpdate,
    pushToShopify = true,
  ): Promise<boolean> => {
    setSaving(true);
    try {
      const dbFields = toDbFields(fields);
      if (Object.keys(dbFields).length) {
        const { error } = await supabase.from("products").update(dbFields).eq("id", productId);
        if (error) throw error;
      }

      if (pushToShopify && storeId) {
        const shopifyFields: SEOFieldUpdate = {};
        if ("meta_title" in fields)       shopifyFields.meta_title       = fields.meta_title;
        if ("meta_description" in fields) shopifyFields.meta_description = fields.meta_description;
        if ("product_type" in fields)     shopifyFields.product_type     = fields.product_type;

        if (Object.keys(shopifyFields).length) {
          const { error } = await supabase.functions.invoke("shopify-seo-push", {
            body: { product_id: productId, store_id: storeId, fields: shopifyFields },
          });
          if (error) throw new Error(error.message);
        }
      }

      toast.success("Saved");
      await invalidate();
      return true;
    } catch (e: any) {
      toast.error("Save failed: " + (e?.message ?? "Unknown error"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** Bulk save multiple products (DB + optional Shopify push) */
  const bulkSave = async (
    updates: { product_id: string; fields: SEOFieldUpdate }[],
    pushToShopify = false,
  ): Promise<number> => {
    if (!updates.length) return 0;
    setSaving(true);
    let saved = 0;
    try {
      await Promise.all(updates.map(async ({ product_id, fields }) => {
        const dbFields = toDbFields(fields);
        if (!Object.keys(dbFields).length) return;
        const { error } = await supabase.from("products").update(dbFields).eq("id", product_id);
        if (!error) saved++;
      }));

      if (pushToShopify && storeId) {
        await supabase.functions.invoke("shopify-seo-push", {
          body: {
            bulk_updates: updates.map(u => ({
              product_id: u.product_id,
              store_id: storeId,
              fields: u.fields,
            })),
          },
        });
      }

      toast.success(`${saved} products updated`);
      await invalidate();
      return saved;
    } catch (e: any) {
      toast.error("Bulk save failed: " + (e?.message ?? "Unknown error"));
      return saved;
    } finally {
      setSaving(false);
    }
  };

  /** Generate AI SEO content for up to 50 products */
  const generateAISEO = async (
    products: { product_id: string; product_name: string; collection_name?: string | null; product_type?: string | null; vendor_name?: string | null }[],
  ): Promise<AIResult[]> => {
    if (!products.length) return [];
    setAiGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("shopify-seo-generate", {
        body: { products: products.slice(0, 50) },
      });
      if (error) throw new Error(error.message);

      const rawResults = (data?.results ?? []) as { product_id: string; meta_title: string; meta_description: string }[];

      // Enrich with product_name for display
      return rawResults.map(r => ({
        ...r,
        product_name: products.find(p => p.product_id === r.product_id)?.product_name ?? r.product_id,
      }));
    } catch (e: any) {
      toast.error("AI generation failed: " + (e?.message ?? "Unknown error"));
      return [];
    } finally {
      setAiGenerating(false);
    }
  };

  return { saving, aiGenerating, saveProduct, bulkSave, generateAISEO };
}
