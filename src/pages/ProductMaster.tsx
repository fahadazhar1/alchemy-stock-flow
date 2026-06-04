import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { useCurrency } from "@/hooks/useCurrency";
import { exportToCSV } from "@/lib/export";
import { toast } from "sonner";
import { Download, RotateCcw, Search, ExternalLink, XCircle, Warehouse, PackagePlus, Pencil, Check, X, RefreshCw } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useCollectionRefresh } from "@/hooks/useCollectionRefresh";
import { DateRangeFilter, matchesDateFilter } from "@/components/DateRangeFilter";
import { useStoreFilter } from "@/hooks/useStoreFilter";

const PAGE_SIZE = 20;

interface AdjustRowData {
  productId: string;
  productName: string;
  sku: string;
  variantId: string;
  shopifyVariantId: string;
  inventoryItemId: string;
  currentStock: number;
  connectionId: string;
}

interface PriceEditData {
  productId: string;
  sku: string;
  variantId: string;
  shopifyVariantId: string;
  currentPrice: number;
  compareAtPrice: number | null;
  connectionId: string;
}

export default function ProductMaster() {
  const { formatCurrency } = useCurrency();
  const { storeId } = useStoreFilter();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [filterDates, setFilterDates] = useState<Date[]>([]);
  const [filterMonths, setFilterMonths] = useState<number[]>([]);
  const [filterYears, setFilterYears] = useState<number[]>([]);
  const queryClient = useQueryClient();
  const hasDateFilter = filterDates.length > 0 || filterMonths.length > 0 || filterYears.length > 0;

  // Adjust Stock dialog state
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustRow, setAdjustRow] = useState<AdjustRowData | null>(null);
  const [adjustMode, setAdjustMode] = useState<"add" | "remove">("add");
  const [adjustUnits, setAdjustUnits] = useState("");
  const [adjustLocationId, setAdjustLocationId] = useState("");
  const [adjustLocations, setAdjustLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [adjustError, setAdjustError] = useState("");
  const [adjustLoading, setAdjustLoading] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportingFull, setExportingFull] = useState(false);

  // Price edit state
  const [priceEditData, setPriceEditData] = useState<PriceEditData | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [priceLoading, setPriceLoading] = useState(false);
  const [compareAtOpen, setCompareAtOpen] = useState(false);
  const [pendingPriceForCompareAt, setPendingPriceForCompareAt] = useState<number | null>(null);
  const [marginWarningOpen, setMarginWarningOpen] = useState(false);
  const [pendingPriceExecutor, setPendingPriceExecutor] = useState<(() => Promise<void>) | null>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (priceEditData) setTimeout(() => priceInputRef.current?.focus(), 50);
  }, [priceEditData?.productId]);

  const { data: collections } = useQuery({
    queryKey: ["filter-collections", storeId],
    queryFn: async () => {
      if (!storeId) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).rpc("get_store_collections", { p_store_id: storeId });
      return ((data ?? []) as { name: string }[]).map(c => ({ name: c.name }));
    },
  });

  const { progress: collRefreshProgress, isRefreshing: isRefreshingCollections, label: collRefreshLabel, refresh: refreshCollections } =
    useCollectionRefresh(storeId, [["filter-collections", storeId]]);

  const { data: vendors } = useQuery({
    queryKey: ["filter-vendors", storeId],
    queryFn: async () => {
      let q = supabase.from("v_product_inventory_summary").select("vendor_name");
      if (storeId) q = q.eq("store_id", storeId);
      const { data } = await q;
      const names = [...new Set((data ?? []).map(d => d.vendor_name).filter(Boolean))].sort() as string[];
      return names.map(name => ({ name }));
    },
  });

  const { data: productTypes } = useQuery({
    queryKey: ["filter-product-types", storeId],
    queryFn: async () => {
      let q = supabase.from("v_product_inventory_summary").select("product_type");
      if (storeId) q = q.eq("store_id", storeId);
      const { data } = await q;
      const types = [...new Set((data ?? []).map(d => d.product_type).filter(Boolean))];
      return types.sort();
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["products", page, search, collectionFilter, vendorFilter, typeFilter, storeId],
    queryFn: async () => {
      try {
        let collectionProductIds: string[] | null = null;
        if (collectionFilter !== "all" && storeId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: ids } = await (supabase as any).rpc("get_collection_product_ids", {
            p_collection_name: collectionFilter,
            p_store_id: storeId,
          });
          collectionProductIds = ((ids ?? []) as { product_id: string }[]).map(r => r.product_id);
        }

        let q = supabase.from("v_product_inventory_summary").select("*", { count: "exact" });
        if (storeId) q = q.eq("store_id", storeId);
        q = q
          .or('collection_name.is.null,collection_name.neq.Trending Now')
          .or('collection_name.is.null,collection_name.neq.Top Selling');
        if (search) q = q.or(`product_name.ilike.%${search}%,sku.ilike.%${search}%`);
        if (collectionProductIds !== null) {
          if (!collectionProductIds.length) return { data: [], count: 0 };
          q = q.in("product_id", collectionProductIds);
        }
        if (vendorFilter !== "all") q = q.eq("vendor_name", vendorFilter);
        if (typeFilter !== "all") q = q.eq("product_type", typeFilter);
        q = q.order("created_at", { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
        const { data, error, count } = await q;
        if (error) throw error;
        return { data: data ?? [], count: count ?? 0 };
      } catch (e) {
        toast.error("Failed to load products");
        return { data: [], count: 0 };
      }
    },
  });

  const { data: centralStockMap } = useQuery({
    queryKey: ["central-stock-map"],
    queryFn: async () => {
      const { data } = await supabase
        .from("v_central_inventory" as any)
        .select("sku, available_quantity, linked_stores_count");
      const map = new Map<string, { centralStock: number; linkedStores: number }>();
      ((data ?? []) as any[]).forEach((r: any) => {
        const baseSku = r.sku?.split('-').slice(0, 2).join('-');
        const existing = map.get(baseSku) || { centralStock: 0, linkedStores: 0 };
        existing.centralStock += r.available_quantity || 0;
        existing.linkedStores = Math.max(existing.linkedStores, r.linked_stores_count || 0);
        map.set(baseSku, existing);
      });
      return map;
    },
  });

  const { data: pricingConfig } = useQuery({
    queryKey: ["pricing-config"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings")
        .select("setting_value").eq("setting_key", "pricing_config").maybeSingle();
      return (data?.setting_value as Record<string, unknown>) ?? {};
    },
  });
  const marginFloor = Number(pricingConfig?.margin_floor_percent ?? 0);

  const { data: shopifyConn } = useQuery({
    queryKey: ["shopify-conn-active", storeId],
    queryFn: async () => {
      let q = supabase.from("shopify_connections").select("id").eq("is_active", true);
      if (storeId) q = (q as any).eq("store_id", storeId);
      const { data } = await (q as any).limit(1).maybeSingle();
      return data as { id: string } | null;
    },
  });

  const filteredData = useMemo(() => {
    if (!data) return { data: [], count: 0 };
    if (!hasDateFilter) return data;
    const filtered = data.data.filter(p => matchesDateFilter(p.created_at, filterDates, filterMonths, filterYears));
    return { data: filtered, count: filtered.length };
  }, [data, filterDates, filterMonths, filterYears, hasDateFilter]);

  const totalPages = Math.ceil(filteredData.count / PAGE_SIZE);

  const toggleSelect = (id: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const selectPage = () => {
    if (!filteredData.data.length) return;
    const pageIds = filteredData.data.map(p => p.product_id!);
    const allSelected = pageIds.every(id => selected.has(id));
    setSelected(prev => {
      const n = new Set(prev);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  const handleRevert = async (productId: string) => {
    try {
      const { data: variants } = await supabase.from("variants").select("id").eq("product_id", productId);
      const variantIds = (variants ?? []).map((v: any) => v.id);
      const { data: campaignItem } = await supabase.from("pricing_campaign_items").select("campaign_id")
        .in("variant_id", variantIds).eq("action_status", "applied").limit(1).maybeSingle();
      const { error: revertErr } = await supabase.rpc("revert_variant_pricing", { p_product_id: productId });
      if (revertErr) throw revertErr;
      if (campaignItem?.campaign_id) {
        const { data: syncResult, error: syncErr } = await supabase.functions.invoke("shopify-sync", {
          body: { action: "revert_prices", campaign_id: campaignItem.campaign_id }
        });
        if (syncErr) throw syncErr;
        if (!syncResult?.ok) throw new Error(syncResult?.error || "Shopify revert failed");
      } else {
        console.warn("No active campaign found for product — DB reverted but Shopify not updated");
      }
      await queryClient.invalidateQueries();
      toast.success("Price reverted successfully on Shopify");
    } catch (e: any) { toast.error(e?.message || "Revert failed"); }
  };

  const handleBulkRemoveDiscount = async () => {
    if (selected.size === 0) return;
    try {
      const ids = Array.from(selected);
      const { data: variants } = await supabase.from("variants").select("id").in("product_id", ids);
      const variantIds = (variants ?? []).map((v: any) => v.id);
      const { data: campaignItems } = await supabase.from("pricing_campaign_items").select("campaign_id")
        .in("variant_id", variantIds).eq("action_status", "applied");
      const campaignIds = [...new Set((campaignItems ?? []).map((i: any) => i.campaign_id))];
      const { data: result, error: revertErr } = await supabase.rpc("revert_variant_pricing", { p_product_ids: ids });
      if (revertErr) throw revertErr;
      for (const campaignId of campaignIds) {
        const { data: syncResult, error: syncErr } = await supabase.functions.invoke("shopify-sync", {
          body: { action: "revert_prices", campaign_id: campaignId }
        });
        if (syncErr) console.error("Shopify revert error", campaignId, syncErr);
        if (!syncResult?.ok) console.error("Shopify revert failed", campaignId, syncResult?.error);
      }
      const r = result as Record<string, unknown>;
      await queryClient.invalidateQueries();
      toast.success(`Discount removed from ${Number(r.affected_count || 0)} variants and pushed to Shopify`);
      setSelected(new Set());
    } catch (e: any) { toast.error(e?.message || "Bulk remove discount failed"); }
  };

  const toExportRow = (p: any) => ({
    Name: p.product_name, SKU: p.sku, Vendor: p.vendor_name, Collection: p.collection_name,
    ProductType: p.product_type, Inventory: p.total_inventory, Price: p.min_current_price,
    OriginalPrice: p.max_compare_at_price, DaysOld: p.days_old, Status: p.discount_status,
    Campaign: p.campaign_name, Expiry: p.near_expiry_status,
  });

  const handleExportPage = () => {
    if (!filteredData.data.length) return;
    exportToCSV(filteredData.data.map(toExportRow), "product-master-page");
    setExportDialogOpen(false);
  };

  const handleExportFull = async () => {
    setExportingFull(true);
    try {
      let collectionProductIds: string[] | null = null;
      if (collectionFilter !== "all" && storeId) {
        const { data: ids } = await (supabase as any).rpc("get_collection_product_ids", {
          p_collection_name: collectionFilter,
          p_store_id: storeId,
        });
        collectionProductIds = ((ids ?? []) as { product_id: string }[]).map(r => r.product_id);
        if (!collectionProductIds.length) { toast.info("No products found for this collection"); return; }
      }

      let q = supabase.from("v_product_inventory_summary").select("*");
      if (storeId) q = q.eq("store_id", storeId);
      q = q
        .or('collection_name.is.null,collection_name.neq.Trending Now')
        .or('collection_name.is.null,collection_name.neq.Top Selling');
      if (search) q = q.or(`product_name.ilike.%${search}%,sku.ilike.%${search}%`);
      if (collectionProductIds !== null) q = q.in("product_id", collectionProductIds);
      if (vendorFilter !== "all") q = q.eq("vendor_name", vendorFilter);
      if (typeFilter !== "all") q = q.eq("product_type", typeFilter);
      q = q.order("created_at", { ascending: false }).limit(10000);

      const { data: allRows, error } = await q;
      if (error) throw error;

      const rows = hasDateFilter
        ? (allRows ?? []).filter((p: any) => matchesDateFilter(p.created_at, filterDates, filterMonths, filterYears))
        : (allRows ?? []);

      if (!rows.length) { toast.info("No products to export"); return; }
      exportToCSV(rows.map(toExportRow), "product-master-full");
      toast.success(`Exported ${rows.length} products`);
      setExportDialogOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Export failed");
    } finally {
      setExportingFull(false);
    }
  };

  const makeShopifyLink = (name: string) => {
    const slug = name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'product';
    return `https://your-store.myshopify.com/products/${slug}`;
  };

  const getWinnerLoserStatus = (daysOld: number | null, inventory: number | null) => {
    const d = daysOld ?? 0; const inv = inventory ?? 0;
    if (d > 20 && inv > 10) return "loser";
    return "winner";
  };

  const resetDateFilter = () => { setFilterDates([]); setFilterMonths([]); setFilterYears([]); };

  const handleForceResync = async () => {
    if (!shopifyConn?.id) { toast.error("No active Shopify connection"); return; }
    setResyncing(true);
    try {
      const { data: result } = await supabase.functions.invoke("shopify-sync", {
        body: { action: "force_resync", connection_id: shopifyConn.id },
      });
      if (!result?.ok) throw new Error(result?.error || "Resync failed");
      toast.success("Full re-sync started — collections and products will update in a few minutes");
    } catch (e: any) {
      toast.error(e?.message || "Failed to start re-sync");
    } finally {
      setResyncing(false);
    }
  };

  // ── Adjust Stock ──────────────────────────────────────────────────────────

  const handleOpenAdjustStock = async (p: any) => {
    if (!shopifyConn?.id) { toast.error("No active Shopify connection"); return; }

    const { data: variant } = await supabase.from("variants")
      .select("id, shopify_variant_id, shopify_inventory_item_id, inventory_quantity")
      .eq("variant_sku", p.sku)
      .maybeSingle();

    if (!variant?.shopify_variant_id || !variant?.shopify_inventory_item_id) {
      toast.error("Shopify variant ID not linked — cannot adjust stock");
      return;
    }

    const { data: locResult } = await supabase.functions.invoke("shopify-sync", {
      body: { action: "get_locations", connection_id: shopifyConn.id },
    });
    const locs: Array<{ id: string; name: string }> = (locResult?.locations ?? []).map((l: any) => ({
      id: String(l.id),
      name: l.name,
    }));

    setAdjustLocations(locs);
    setAdjustLocationId(locs[0]?.id ?? "");
    setAdjustMode("add");
    setAdjustUnits("");
    setAdjustError("");
    setAdjustRow({
      productId: p.product_id,
      productName: p.product_name ?? "",
      sku: p.sku,
      variantId: variant.id,
      shopifyVariantId: variant.shopify_variant_id,
      inventoryItemId: variant.shopify_inventory_item_id,
      currentStock: variant.inventory_quantity ?? 0,
      connectionId: shopifyConn.id,
    });
    setAdjustOpen(true);
  };

  const handleConfirmAdjust = async () => {
    if (!adjustRow) return;
    const units = parseInt(adjustUnits, 10);
    if (!adjustUnits || isNaN(units) || units < 1 || units > 10000) {
      setAdjustError("Enter a whole number between 1 and 10,000");
      return;
    }
    if (adjustMode === "remove" && units > adjustRow.currentStock) {
      setAdjustError(`Cannot remove more units than available stock (${adjustRow.currentStock} in stock)`);
      return;
    }
    if (!adjustLocationId) { setAdjustError("Please select a location"); return; }

    const adjustment = adjustMode === "add" ? units : -units;
    setAdjustLoading(true);
    setAdjustError("");

    try {
      const { data: result } = await supabase.functions.invoke("shopify-sync", {
        body: {
          action: "adjust_inventory",
          connection_id: adjustRow.connectionId,
          inventory_item_id: adjustRow.inventoryItemId,
          location_id: adjustLocationId,
          adjustment,
        },
      });

      if (!result?.ok) {
        toast.error("Shopify update failed — stock unchanged");
        await supabase.from("inventory_sync_logs").insert({
          action_type: "inventory_adjustment", campaign_name: null, items_affected: 1, status: "failed",
          metadata: { sku: adjustRow.sku, adjustment, location_id: adjustLocationId, error: result?.error ?? "unknown" },
        });
        return;
      }

      const newQty = adjustRow.currentStock + adjustment;
      await supabase.from("variants")
        .update({ inventory_quantity: newQty })
        .eq("id", adjustRow.variantId)
        .eq("variant_sku", adjustRow.sku);

      await supabase.from("inventory_sync_logs").insert({
        action_type: "inventory_adjustment", campaign_name: null, items_affected: 1, status: "success",
        metadata: { sku: adjustRow.sku, adjustment, location_id: adjustLocationId, new_quantity: newQty },
      });

      toast.success(`Stock updated — ${adjustRow.sku} adjusted by ${adjustment > 0 ? "+" : ""}${adjustment} units`);
      setAdjustOpen(false);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Stock adjustment failed");
    } finally {
      setAdjustLoading(false);
    }
  };

  // ── Price Edit ────────────────────────────────────────────────────────────

  const handleOpenPriceEdit = async (p: any) => {
    if (!shopifyConn?.id) { toast.error("No active Shopify connection"); return; }

    const { data: variant } = await supabase.from("variants")
      .select("id, shopify_variant_id, price, compare_at_price")
      .eq("variant_sku", p.sku)
      .maybeSingle();

    if (!variant?.shopify_variant_id) {
      toast.error("Shopify variant ID not linked — cannot edit price");
      return;
    }

    setPriceEditData({
      productId: p.product_id,
      sku: p.sku,
      variantId: variant.id,
      shopifyVariantId: variant.shopify_variant_id,
      currentPrice: variant.price,
      compareAtPrice: variant.compare_at_price ?? null,
      connectionId: shopifyConn.id,
    });
    setPriceInput(String(variant.price));
  };

  const handleCancelPriceEdit = () => { setPriceEditData(null); setPriceInput(""); };

  const commitPriceToShopify = async (data: PriceEditData, newPrice: number, newCompareAt?: number | null) => {
    setPriceLoading(true);
    try {
      const reqBody: Record<string, unknown> = {
        action: "edit_price",
        connection_id: data.connectionId,
        shopify_variant_id: data.shopifyVariantId,
        new_price: newPrice,
      };
      if (newCompareAt !== undefined) reqBody.new_compare_at_price = newCompareAt;

      const { data: result } = await supabase.functions.invoke("shopify-sync", { body: reqBody });

      if (!result?.ok) {
        toast.error("Shopify update failed — price unchanged");
        setPriceInput(String(data.currentPrice));
        await supabase.from("inventory_sync_logs").insert({
          action_type: "price_edit", items_affected: 1, status: "failed",
          metadata: { sku: data.sku, old_price: data.currentPrice, new_price: newPrice, shopify_variant_id: data.shopifyVariantId, error: result?.error },
        });
        return;
      }

      const patch: Record<string, unknown> = { price: newPrice };
      if (newCompareAt !== undefined) patch.compare_at_price = newCompareAt;

      await supabase.from("variants")
        .update(patch)
        .eq("id", data.variantId)
        .eq("variant_sku", data.sku);

      await supabase.from("inventory_sync_logs").insert({
        action_type: "price_edit", items_affected: 1, status: "success",
        metadata: { sku: data.sku, old_price: data.currentPrice, new_price: newPrice, shopify_variant_id: data.shopifyVariantId },
      });

      toast.success(`Price updated — ${data.sku} set to ${formatCurrency(newPrice)}`);
      setPriceEditData(null);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Price update failed");
      setPriceInput(String(data.currentPrice));
    } finally {
      setPriceLoading(false);
    }
  };

  const handleConfirmPriceEdit = async () => {
    if (!priceEditData) return;
    const newPrice = parseFloat(priceInput);
    if (isNaN(newPrice) || newPrice < 0.01 || newPrice > 999999) {
      toast.error("Price must be between 0.01 and 999,999");
      return;
    }

    const capturedData = priceEditData;

    const proceedWithPrice = async () => {
      if (capturedData.compareAtPrice !== null) {
        setPendingPriceForCompareAt(newPrice);
        setCompareAtOpen(true);
      } else {
        await commitPriceToShopify(capturedData, newPrice, undefined);
      }
    };

    if (marginFloor > 0) {
      const reference = capturedData.compareAtPrice ?? capturedData.currentPrice;
      if (newPrice < reference * (1 - marginFloor / 100)) {
        setPendingPriceExecutor(() => proceedWithPrice);
        setMarginWarningOpen(true);
        return;
      }
    }

    await proceedWithPrice();
  };

  const handlePriceKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleConfirmPriceEdit(); }
    if (e.key === "Escape") handleCancelPriceEdit();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Product Master</h1>
          <p className="text-sm text-muted-foreground">Complete inventory ledger with pricing actions</p>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <Button variant="destructive" size="sm" onClick={handleBulkRemoveDiscount}>
              <XCircle className="h-4 w-4 mr-1" /> Remove Discount ({selected.size})
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={handleForceResync}
                disabled={resyncing}
                className="border-amber-300 text-amber-700 hover:bg-amber-50 hover:border-amber-400 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30"
              >
                <RotateCcw className={`h-4 w-4 mr-1 ${resyncing ? "animate-spin" : ""}`} />
                {resyncing ? "Re-syncing…" : "Full Re-sync"}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[220px] text-center">
              Wipes sync history and re-pulls everything from Shopify from scratch. Use when data looks wrong or missing.
            </TooltipContent>
          </Tooltip>
          <Button variant="outline" size="sm" onClick={() => setExportDialogOpen(true)}><Download className="h-4 w-4 mr-1" />Export CSV</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search name or SKU..." className="pl-8" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Select value={collectionFilter} onValueChange={v => { setCollectionFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Collection" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Collections</SelectItem>
                {collections?.filter(c => !["trending now", "top selling"].includes(c.name.toLowerCase())).map(c => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs gap-1 text-muted-foreground shrink-0"
                  onClick={refreshCollections}
                  disabled={isRefreshingCollections}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingCollections ? "animate-spin" : ""}`} />
                  {isRefreshingCollections ? "Refreshing…" : "Refresh Collections"}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Pull latest collection names from Shopify</TooltipContent>
            </Tooltip>
          </div>
          {isRefreshingCollections && (
            <div className="w-full space-y-0.5">
              <Progress value={collRefreshProgress.percent} className="h-1.5" />
              <p className="text-[10px] text-muted-foreground truncate">{collRefreshLabel}</p>
            </div>
          )}
        </div>
        <Select value={vendorFilter} onValueChange={v => { setVendorFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Vendor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Vendors</SelectItem>
            {vendors?.map(v => <SelectItem key={v.name} value={v.name}>{v.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={v => { setTypeFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {productTypes?.map(t => <SelectItem key={t} value={t!}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <DateRangeFilter
          selectedDates={filterDates} selectedMonths={filterMonths} selectedYears={filterYears}
          onDatesChange={setFilterDates} onMonthsChange={setFilterMonths} onYearsChange={setFilterYears}
          onReset={resetDateFilter}
        />
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{selected.size} selected</Badge>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><Checkbox checked={filteredData.data.length > 0 && filteredData.data.every(p => selected.has(p.product_id!))} onCheckedChange={selectPage} /></TableHead>
                  <TableHead className="w-16">Status</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Collection</TableHead>
                  <TableHead className="text-right">Store Stock</TableHead>
                  <TableHead className="text-right">
                    <Tooltip><TooltipTrigger className="flex items-center gap-1 ml-auto"><Warehouse className="h-3 w-3" />Central</TooltipTrigger><TooltipContent>Central WMS stock (shared across stores)</TooltipContent></Tooltip>
                  </TableHead>
                  <TableHead className="text-center">Stores</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Original</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="w-24">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.data.map(p => {
                  const status = getWinnerLoserStatus(p.days_old, p.total_inventory);
                  const baseSku = p.sku?.split('-').slice(0, 2).join('-');
                  const central = centralStockMap?.get(baseSku || '');
                  const isEditingPrice = priceEditData?.productId === p.product_id;
                  return (
                    <TableRow key={p.product_id} data-state={selected.has(p.product_id!) ? "selected" : undefined}>
                      <TableCell><Checkbox checked={selected.has(p.product_id!)} onCheckedChange={() => toggleSelect(p.product_id!)} /></TableCell>
                      <TableCell>
                        {status === "loser" ? <Badge variant="destructive" className="text-[10px]">Loser</Badge> : <Badge className="bg-emerald-500 hover:bg-emerald-600 text-[10px]">Winner</Badge>}
                      </TableCell>
                      <TableCell className="font-medium max-w-[200px] truncate">
                        <a href={makeShopifyLink(p.product_name || '')} target="_blank" rel="noopener noreferrer" className="hover:underline inline-flex items-center gap-1">
                          {p.product_name}<ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </a>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                      <TableCell className="text-xs">{p.collection_name || '-'}</TableCell>
                      <TableCell className="text-right font-mono">{p.total_inventory}</TableCell>
                      <TableCell className="text-right font-mono text-primary">{central?.centralStock?.toLocaleString() ?? '-'}</TableCell>
                      <TableCell className="text-center">
                        {central?.linkedStores ? <Badge variant="outline" className="text-[10px]">{central.linkedStores}</Badge> : '-'}
                      </TableCell>

                      {/* Price cell — inline editable */}
                      <TableCell className="text-right font-mono">
                        {isEditingPrice ? (
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              ref={priceInputRef}
                              type="number"
                              step="0.01"
                              min="0.01"
                              max="999999"
                              value={priceInput}
                              onChange={e => setPriceInput(e.target.value)}
                              onKeyDown={handlePriceKeyDown}
                              className="w-24 h-7 text-xs text-right"
                              disabled={priceLoading}
                            />
                            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={handleConfirmPriceEdit} disabled={priceLoading}>
                              <Check className="h-3 w-3 text-green-600" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={handleCancelPriceEdit} disabled={priceLoading}>
                              <X className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        ) : (
                          <div
                            className="group flex items-center justify-end gap-1 cursor-pointer select-none"
                            onClick={() => handleOpenPriceEdit(p)}
                          >
                            <span>{p.min_current_price ? formatCurrency(p.min_current_price) : '-'}</span>
                            <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="text-right font-mono">{p.max_compare_at_price ? formatCurrency(p.max_compare_at_price) : '-'}</TableCell>
                      <TableCell className="text-right">{p.days_old}</TableCell>
                      <TableCell><Badge variant={p.discount_status === 'discounted' ? 'default' : 'secondary'}>{p.discount_status}</Badge></TableCell>
                      <TableCell className="text-xs">{p.campaign_name || '-'}</TableCell>
                      <TableCell><Badge variant={p.near_expiry_status === 'Expired' ? 'destructive' : p.near_expiry_status === 'Expiring Soon' ? 'outline' : 'secondary'} className="text-xs">{p.near_expiry_status}</Badge></TableCell>

                      {/* Actions column */}
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="sm" onClick={() => handleOpenAdjustStock(p)}>
                                <PackagePlus className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Adjust Stock</TooltipContent>
                          </Tooltip>
                          {p.discount_status === 'discounted' && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" onClick={() => handleRevert(p.product_id!)}>
                                  <RotateCcw className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Revert Price</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{filteredData.count} products total</span>
            {!hasDateFilter && totalPages > 1 && (
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
                <span className="text-sm flex items-center px-2">{page + 1}/{totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Export choice dialog ───────────────────────────────────────── */}
      <Dialog open={exportDialogOpen} onOpenChange={open => { if (!exportingFull) setExportDialogOpen(open); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Export CSV</DialogTitle>
            <DialogDescription>Choose what to include in the export.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Button variant="outline" className="justify-start h-auto py-3 px-4" onClick={handleExportPage} disabled={exportingFull}>
              <div className="text-left">
                <div className="font-medium">Current page</div>
                <div className="text-xs text-muted-foreground mt-0.5">{filteredData.data.length} products visible on this page</div>
              </div>
            </Button>
            <Button variant="outline" className="justify-start h-auto py-3 px-4" onClick={handleExportFull} disabled={exportingFull}>
              <div className="text-left">
                <div className="font-medium flex items-center gap-2">
                  Full catalog
                  {exportingFull && <span className="text-xs text-muted-foreground">(fetching…)</span>}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {filteredData.count} products matching current filters
                </div>
              </div>
            </Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setExportDialogOpen(false)} disabled={exportingFull}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Adjust Stock Dialog ─────────────────────────────────────────── */}
      <Dialog open={adjustOpen} onOpenChange={open => { if (!open && !adjustLoading) setAdjustOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adjust Stock</DialogTitle>
            <DialogDescription>
              {adjustRow?.productName} — <span className="font-mono text-xs">{adjustRow?.sku}</span>
              <span className="ml-2 text-muted-foreground">({adjustRow?.currentStock} currently in stock)</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="mb-2 block">Action</Label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={adjustMode === "add" ? "default" : "outline"}
                  onClick={() => { setAdjustMode("add"); setAdjustError(""); }}
                  disabled={adjustLoading}
                >
                  Add
                </Button>
                <Button
                  size="sm"
                  variant={adjustMode === "remove" ? "default" : "outline"}
                  onClick={() => { setAdjustMode("remove"); setAdjustError(""); }}
                  disabled={adjustLoading}
                >
                  Remove
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="adjust-units">Units</Label>
              <Input
                id="adjust-units"
                type="number"
                min={1}
                max={10000}
                value={adjustUnits}
                onChange={e => { setAdjustUnits(e.target.value); setAdjustError(""); }}
                onKeyDown={e => { if (e.key === "Enter") handleConfirmAdjust(); }}
                placeholder="Enter quantity"
                disabled={adjustLoading}
              />
            </div>
            {adjustLocations.length > 1 && (
              <div className="space-y-1">
                <Label htmlFor="adjust-location">Location</Label>
                <Select value={adjustLocationId} onValueChange={setAdjustLocationId} disabled={adjustLoading}>
                  <SelectTrigger id="adjust-location"><SelectValue placeholder="Select location" /></SelectTrigger>
                  <SelectContent>
                    {adjustLocations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {adjustError && <p className="text-sm text-destructive">{adjustError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustOpen(false)} disabled={adjustLoading}>Cancel</Button>
            <Button onClick={handleConfirmAdjust} disabled={adjustLoading}>
              {adjustLoading ? "Updating..." : "Update Stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Compare-at price prompt ─────────────────────────────────────── */}
      <Dialog open={compareAtOpen} onOpenChange={open => { if (!open && !priceLoading) setCompareAtOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Update Compare-At Price?</DialogTitle>
            <DialogDescription>
              This product has a compare-at price of{" "}
              <strong>{priceEditData?.compareAtPrice ? formatCurrency(priceEditData.compareAtPrice) : ""}</strong>.
              Update that too?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={priceLoading}
              onClick={async () => {
                setCompareAtOpen(false);
                if (priceEditData && pendingPriceForCompareAt !== null) {
                  await commitPriceToShopify(priceEditData, pendingPriceForCompareAt, undefined);
                }
                setPendingPriceForCompareAt(null);
              }}
            >
              No, keep {priceEditData?.compareAtPrice ? formatCurrency(priceEditData.compareAtPrice) : ""}
            </Button>
            <Button
              disabled={priceLoading}
              onClick={async () => {
                setCompareAtOpen(false);
                if (priceEditData && pendingPriceForCompareAt !== null) {
                  await commitPriceToShopify(priceEditData, pendingPriceForCompareAt, pendingPriceForCompareAt);
                }
                setPendingPriceForCompareAt(null);
              }}
            >
              {priceLoading ? "Saving..." : "Yes, update both"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Margin floor warning ────────────────────────────────────────── */}
      <AlertDialog open={marginWarningOpen} onOpenChange={setMarginWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Below Margin Floor</AlertDialogTitle>
            <AlertDialogDescription>
              The new price is below the {marginFloor}% margin floor threshold configured in settings. Are you sure you want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setMarginWarningOpen(false); setPendingPriceExecutor(null); }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setMarginWarningOpen(false);
                await pendingPriceExecutor?.();
                setPendingPriceExecutor(null);
              }}
            >
              Proceed Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
