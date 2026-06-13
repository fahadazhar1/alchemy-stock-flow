import { useState, useMemo, useEffect } from "react";
import { useRole } from "@/hooks/useRole";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/useCurrency";
import { RefreshCw, Eye, Zap, Filter, ChevronDown, X, Globe } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useCollectionRefresh } from "@/hooks/useCollectionRefresh";
import { Json } from "@/integrations/supabase/types";
import { DateRangeFilter, matchesDateFilter } from "@/components/DateRangeFilter";
import { useStoreFilter } from "@/hooks/useStoreFilter";

const PAGE_SIZE = 20;

export default function ManualSync() {
  const { canEdit } = useRole();
  const { formatCurrency, symbol } = useCurrency();
  const { storeId, isAllStores } = useStoreFilter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [discountPercent, setDiscountPercent] = useState("");
  const [fixedPrice, setFixedPrice] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [roundingMode, setRoundingMode] = useState("whole");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<Json | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [collectionTargets, setCollectionTargets] = useState<Set<string>>(new Set());
  const [collectionPopoverOpen, setCollectionPopoverOpen] = useState(false);
  const [collectionSearch, setCollectionSearch] = useState("");
  const [filterDates, setFilterDates] = useState<Date[]>([]);
  const [filterMonths, setFilterMonths] = useState<number[]>([]);
  const [filterYears, setFilterYears] = useState<number[]>([]);
  const [selectingAll, setSelectingAll] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem("campaign_prefill_products");
    if (!raw) return;
    sessionStorage.removeItem("campaign_prefill_products");
    try {
      const ids: string[] = JSON.parse(raw);
      if (ids.length) {
        setSelected(new Set(ids));
        toast.info(`${ids.length} product${ids.length > 1 ? "s" : ""} pre-selected from deadstock`);
      }
    } catch {}
  }, []);
  const hasDateFilter = filterDates.length > 0 || filterMonths.length > 0 || filterYears.length > 0;

  const { data: collections } = useQuery({
    queryKey: ["sync-collections", storeId],
    queryFn: async () => {
      if (!storeId) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).rpc("get_store_collections", { p_store_id: storeId });
      return ((data ?? []) as { name: string }[]).map(c => ({ name: c.name }));
    },
  });

  const { progress: collRefreshProgress, isRefreshing: isRefreshingCollections, label: collRefreshLabel, refresh: refreshCollections } =
    useCollectionRefresh(storeId, [["sync-collections", storeId]]);

  const { data: vendors } = useQuery({
    queryKey: ["sync-vendors", storeId],
    queryFn: async () => {
      let q = supabase.from("v_product_inventory_summary").select("vendor_name");
      if (storeId) q = q.eq("store_id", storeId);
      const { data } = await q;
      const names = [...new Set((data ?? []).map(d => d.vendor_name).filter(Boolean))].sort() as string[];
      return names.map(name => ({ name }));
    },
  });

  const { data: productTypes } = useQuery({
    queryKey: ["sync-product-types", storeId],
    queryFn: async () => {
      let q = supabase.from("v_product_inventory_summary").select("product_type");
      if (storeId) q = q.eq("store_id", storeId);
      const { data } = await q;
      return [...new Set((data ?? []).map(d => d.product_type).filter(Boolean))].sort();
    },
  });

  const { data: products } = useQuery({
    queryKey: ["sync-products", page, search, collectionFilter, vendorFilter, typeFilter, storeId],
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
      } catch {
        toast.error("Failed to load products");
        return { data: [], count: 0 };
      }
    },
  });

  const { data: settings } = useQuery({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("*").eq("setting_key", "pricing_config").maybeSingle();
      return (data?.setting_value ?? null) as Record<string, unknown> | null;
    },
  });

  const requireApproval = settings?.require_approval ?? true;

  const filteredProducts = useMemo(() => {
    if (!products) return { data: [], count: 0 };
    if (!hasDateFilter) return products;
    const filtered = products.data.filter(p => matchesDateFilter(p.created_at, filterDates, filterMonths, filterYears));
    return { data: filtered, count: filtered.length };
  }, [products, filterDates, filterMonths, filterYears, hasDateFilter]);

  const totalPages = filteredProducts ? Math.ceil(filteredProducts.count / PAGE_SIZE) : 0;

  const toggleSelectAll = () => {
    if (!filteredProducts?.data.length) return;
    const pageIds = filteredProducts.data.map(p => p.product_id!);
    const allSelected = pageIds.every(id => selected.has(id));
    setSelected(prev => {
      const n = new Set(prev);
      if (allSelected) pageIds.forEach(id => n.delete(id));
      else pageIds.forEach(id => n.add(id));
      return n;
    });
  };

  const selectByFilter = async (filterType: string, filterValue: string) => {
    try {
      let ids: string[] = [];
      if (filterType === "collection") {
        if (storeId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: rows } = await (supabase as any).rpc("get_collection_product_ids", {
            p_collection_name: filterValue,
            p_store_id: storeId,
          });
          ids = ((rows ?? []) as { product_id: string }[]).map(r => r.product_id);

          // No products linked yet — sync from Shopify then retry
          if (ids.length === 0) {
            toast.info(`Syncing products for "${filterValue}" from Shopify…`);
            const { data: syncResult } = await supabase.functions.invoke("shopify-sync", {
              body: { action: "sync_collection_products", store_id: storeId, collection_name: filterValue },
            });
            if (syncResult?.ok) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const { data: rows2 } = await (supabase as any).rpc("get_collection_product_ids", {
                p_collection_name: filterValue,
                p_store_id: storeId,
              });
              ids = ((rows2 ?? []) as { product_id: string }[]).map(r => r.product_id);
            } else {
              toast.error(syncResult?.error ?? "Could not sync collection products");
            }
          }
        }
      } else {
        let q = supabase.from("v_product_inventory_summary").select("product_id");
        if (storeId) q = q.eq("store_id", storeId);
        if (filterType === "vendor") q = q.eq("vendor_name", filterValue);
        else if (filterType === "type") q = q.eq("product_type", filterValue);
        const { data, error } = await q;
        if (error) throw error;
        ids = (data ?? []).map(p => p.product_id).filter(Boolean) as string[];
      }
      setSelected(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n; });
      toast.success(`Added ${ids.length} products from ${filterValue}`);
    } catch { toast.error("Failed to select by filter"); }
  };

  const toggleCollectionTarget = async (collectionName: string, checked: boolean) => {
    setCollectionTargets(prev => {
      const n = new Set(prev);
      checked ? n.add(collectionName) : n.delete(collectionName);
      return n;
    });
    if (checked) {
      await selectByFilter("collection", collectionName);
    } else {
      // Deselect products that belong to this collection
      try {
        if (storeId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: rows } = await (supabase as any).rpc("get_collection_product_ids", {
            p_collection_name: collectionName,
            p_store_id: storeId,
          });
          const ids = ((rows ?? []) as { product_id: string }[]).map(r => r.product_id);
          setSelected(prev => {
            const n = new Set(prev);
            ids.forEach(id => n.delete(id));
            return n;
          });
        }
      } catch { toast.error("Failed to deselect collection"); }
    }
  };

  const toggleAllCollections = async (checked: boolean) => {
    if (checked) {
      const allNames = (collections ?? []).map(c => c.name);
      setCollectionTargets(new Set(allNames));
      try {
        let q = supabase.from("v_product_inventory_summary").select("product_id");
        if (storeId) q = q.eq("store_id", storeId);
        const { data } = await q;
        const ids = (data ?? []).map(p => p.product_id).filter(Boolean) as string[];
        setSelected(new Set(ids));
        toast.success(`Selected all ${ids.length} products`);
      } catch { toast.error("Failed to select all"); }
    } else {
      setCollectionTargets(new Set());
      setSelected(new Set());
    }
  };

  const handleSelectEntireWebsite = async () => {
    if (isAllStores) { toast.error("Select a specific store first"); return; }
    setSelectingAll(true);
    try {
      const allIds: string[] = [];
      const BATCH = 1000;
      let from = 0;
      while (true) {
        let q = supabase.from("v_product_inventory_summary").select("product_id");
        if (storeId) q = q.eq("store_id", storeId);
        q = q.range(from, from + BATCH - 1);
        const { data, error } = await q;
        if (error) throw error;
        const batch = (data ?? []).map(p => p.product_id).filter(Boolean) as string[];
        allIds.push(...batch);
        if (batch.length < BATCH) break;
        from += BATCH;
      }
      setSelected(new Set(allIds));
      toast.success(`Selected all ${allIds.length} products in store`);
    } catch { toast.error("Failed to select all products"); } finally { setSelectingAll(false); }
  };

  const handlePreview = async (forceOverwrite?: boolean) => {
    if (isAllStores) { toast.error("Select a specific store before previewing a campaign"); return; }
    if (!selected.size) { toast.error("Select products first"); return; }
    if (!campaignName.trim()) { toast.error("Campaign name is required"); return; }
    if (!discountPercent && !fixedPrice) { toast.error("Enter discount % or fixed price"); return; }
    try {
      const useOverwrite = forceOverwrite ?? overwrite;
      const { data, error } = await supabase.rpc("preview_bulk_discount", {
        p_product_ids: Array.from(selected),
        p_discount_percent: discountPercent ? Number(discountPercent) : null,
        p_fixed_price: fixedPrice ? Number(fixedPrice) : null,
        p_overwrite_existing: useOverwrite,
        p_rounding_mode: roundingMode,
      });
      if (error) throw error;
      setPreviewData(data);
      setPreviewOpen(true);
    } catch { toast.error("Preview failed"); }
  };

  const handleSync = async () => {
  if (isAllStores) { toast.error("Select a specific store before launching a campaign"); return; }
  if (!campaignName.trim()) { toast.error("Campaign name is required"); return; }
  if (!discountPercent && !fixedPrice) { toast.error("Enter discount % or fixed price"); return; }
  setSyncing(true);
  try {
    const ids = Array.from(selected);
    if (requireApproval) {
      const { data: draftResult, error } = await supabase.rpc("create_campaign_draft", {
        p_product_ids: ids,
        p_discount_percent: discountPercent ? Number(discountPercent) : null,
        p_fixed_price: fixedPrice ? Number(fixedPrice) : null,
        p_campaign_name: campaignName, p_overwrite_existing: overwrite,
        p_rounding_mode: roundingMode, p_source: "manual",
        p_store_id: storeId,
      });
      if (error) throw error;
      const itemsCount = (draftResult as any)?.items_count ?? 0;
      if (itemsCount === 0) {
        toast.warning("Draft created but 0 products eligible — all selected products may already be discounted. Enable \"Overwrite Existing\" to re-apply.");
      } else {
        toast.success(`Campaign draft created — ${itemsCount} products pending approval`);
      }
    } else {
      // Step 1: Apply in DB
      const { data: result, error } = await supabase.rpc("apply_bulk_discount", {
        p_product_ids: ids,
        p_discount_percent: discountPercent ? Number(discountPercent) : null,
        p_fixed_price: fixedPrice ? Number(fixedPrice) : null,
        p_campaign_name: campaignName, p_overwrite_existing: overwrite,
        p_rounding_mode: roundingMode,
        p_store_id: storeId,
      });
      if (error) throw error;

      // Step 2: Push to Shopify
      const campaignId = (result as any)?.campaign_id;
      if (campaignId) {
        const { data: syncResult, error: syncErr } = await supabase.functions.invoke("shopify-sync", {
          body: { action: "push_prices", campaign_id: campaignId }
        });
        if (syncErr) throw syncErr;
        if (!syncResult?.ok) throw new Error(syncResult?.error || syncResult?.failed?.[0] || "Shopify push failed");
        toast.success("Pricing synced to Shopify successfully!");
      } else {
        toast.success("Pricing applied in DB (no Shopify push — campaign ID missing)");
      }
    }
    queryClient.invalidateQueries();
    setPreviewOpen(false); setSelected(new Set()); setCampaignName(""); setDiscountPercent(""); setFixedPrice("");
  } catch (e: any) {
    const msg: string = e?.message || "Sync failed";
    if (msg.includes("pricing_campaigns_name_key") || msg.includes("unique constraint")) {
      toast.error(`Campaign name "${campaignName}" already exists — use a different name`);
    } else {
      toast.error(msg);
    }
  } finally { setSyncing(false); }
};

  const canSync = !isAllStores && campaignName.trim() && (discountPercent || fixedPrice) && selected.size > 0;
  const preview = previewData as Record<string, unknown> | null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><RefreshCw className="h-6 w-6" /> Sales Campaign</h1>
        <p className="text-sm text-muted-foreground">Command center for manual pricing campaigns</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-base">Campaign Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div><Label>Campaign Name *</Label><Input value={campaignName} onChange={e => setCampaignName(e.target.value)} placeholder="e.g. Ramadan Push v2" /></div>
            <div><Label>Discount %</Label><Input type="number" min="0" max="99" value={discountPercent} onChange={e => { setDiscountPercent(e.target.value); setFixedPrice(""); }} placeholder="0-99" /></div>
            <div><Label>Fixed Price Override</Label><Input type="number" min="0" value={fixedPrice} onChange={e => { setFixedPrice(e.target.value); setDiscountPercent(""); }} placeholder={symbol.trim()} /></div>
            <div><Label>Rounding</Label>
              <Select value={roundingMode} onValueChange={setRoundingMode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="whole">Whole Numbers</SelectItem><SelectItem value=".00">.00</SelectItem><SelectItem value=".99">.99</SelectItem><SelectItem value="fahads_choice">Fahad's Choice ({symbol}0.50)</SelectItem></SelectContent></Select>
            </div>
            <div className="flex items-center justify-between"><Label>Overwrite Existing</Label><Switch checked={overwrite} onCheckedChange={setOverwrite} /></div>
            <div className="border-t pt-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1"><Filter className="h-3 w-3" /> Quick Target by</p>
              <div className="space-y-2">
                {/* Entire Website */}
                <Button
                  variant="outline"
                  className="h-8 w-full text-xs justify-start gap-2 font-normal"
                  onClick={handleSelectEntireWebsite}
                  disabled={isAllStores || selectingAll}
                >
                  <Globe className="h-3 w-3" />
                  {selectingAll ? "Loading…" : "Entire Website"}
                </Button>
                {/* Multi-select Collections */}
                <div className="flex flex-col gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-full text-xs gap-1.5 justify-start px-2 text-muted-foreground"
                    onClick={() => {
                      if (isAllStores) { toast.error("Select a specific store first"); return; }
                      refreshCollections();
                    }}
                    disabled={isRefreshingCollections}
                    title={isAllStores ? "Select a specific store first" : "Pull latest collection names from Shopify"}
                  >
                    <RefreshCw className={`h-3 w-3 shrink-0 ${isRefreshingCollections ? "animate-spin" : ""}`} />
                    {isRefreshingCollections ? "Refreshing Collections…" : "Refresh Collections"}
                  </Button>
                  {isRefreshingCollections && (
                    <div className="space-y-0.5">
                      <Progress value={collRefreshProgress.percent} className="h-1.5" />
                      <p className="text-[10px] text-muted-foreground truncate">{collRefreshLabel}</p>
                    </div>
                  )}
                </div>
                <Popover open={collectionPopoverOpen} onOpenChange={setCollectionPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-8 w-full text-xs justify-between font-normal">
                      {collectionTargets.size === 0
                        ? `+ Add Collection ${collections?.length ? `(${collections.length})` : ""}`
                        : collectionTargets.size === (collections?.length ?? 0)
                          ? "All Collections"
                          : `${collectionTargets.size} collection${collectionTargets.size > 1 ? "s" : ""} selected`}
                      <ChevronDown className="h-3 w-3 ml-1 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-2" align="start">
                    <Input
                      placeholder="Search collections…"
                      value={collectionSearch}
                      onChange={e => setCollectionSearch(e.target.value)}
                      className="h-7 text-xs mb-2"
                    />
                    <div className="max-h-64 overflow-y-auto space-y-1">
                      {!collectionSearch && (
                        <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-xs font-semibold border-b pb-2 mb-1">
                          <Checkbox
                            checked={collectionTargets.size === (collections?.length ?? 0) && (collections?.length ?? 0) > 0}
                            onCheckedChange={checked => toggleAllCollections(!!checked)}
                          />
                          All Collections
                        </label>
                      )}
                      {(collections ?? [])
                        .filter(c => c.name.toLowerCase().includes(collectionSearch.toLowerCase()))
                        .map(c => (
                          <label key={c.name} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-xs">
                            <Checkbox
                              checked={collectionTargets.has(c.name)}
                              onCheckedChange={checked => toggleCollectionTarget(c.name, !!checked)}
                            />
                            {c.name}
                          </label>
                        ))}
                      {collectionSearch && (collections ?? []).filter(c => c.name.toLowerCase().includes(collectionSearch.toLowerCase())).length === 0 && (
                        <p className="text-xs text-muted-foreground px-2 py-2">No collections found</p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                {/* Selected collection badges */}
                {collectionTargets.size > 0 && collectionTargets.size < (collections?.length ?? 0) && (
                  <div className="flex flex-wrap gap-1">
                    {Array.from(collectionTargets).map(name => (
                      <Badge key={name} variant="secondary" className="text-xs gap-1 pr-1">
                        {name}
                        <button onClick={() => toggleCollectionTarget(name, false)} className="ml-0.5 hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
                      </Badge>
                    ))}
                  </div>
                )}
                <Select onValueChange={v => selectByFilter("vendor", v)}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="+ Add Vendor" /></SelectTrigger><SelectContent>{vendors?.map(v => <SelectItem key={v.name} value={v.name}>{v.name}</SelectItem>)}</SelectContent></Select>
                <Select onValueChange={v => selectByFilter("type", v)}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="+ Add Product Type" /></SelectTrigger><SelectContent>{productTypes?.map(t => <SelectItem key={t} value={t!}>{t}</SelectItem>)}</SelectContent></Select>
              </div>
            </div>
            <div className="pt-2 space-y-2">
              <Badge variant="secondary">{selected.size} products selected</Badge>
              {isAllStores && <p className="text-xs text-red-600 font-medium">⚠ Select a specific store to enable campaigns</p>}
              {requireApproval && !isAllStores && <p className="text-xs text-amber-600">⚠ Approval required before live execution</p>}
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => handlePreview()} disabled={!canSync || syncing || !canEdit}><Zap className="h-4 w-4 mr-1" /> {requireApproval ? "Review & Draft" : "Review & Sync"}</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Select Products</CardTitle>
              <div className="flex gap-2">
                <Select value={collectionFilter} onValueChange={v => { setCollectionFilter(v); setPage(0); }}><SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Collection" /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem>{collections?.map(c => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}</SelectContent></Select>
                <Select value={vendorFilter} onValueChange={v => { setVendorFilter(v); setPage(0); }}><SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Vendor" /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem>{vendors?.map(v => <SelectItem key={v.name} value={v.name}>{v.name}</SelectItem>)}</SelectContent></Select>
                <DateRangeFilter selectedDates={filterDates} selectedMonths={filterMonths} selectedYears={filterYears} onDatesChange={setFilterDates} onMonthsChange={setFilterMonths} onYearsChange={setFilterYears} onReset={() => { setFilterDates([]); setFilterMonths([]); setFilterYears([]); }} />
              </div>
            </div>
            <Input placeholder="Search..." value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} className="mt-2" />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"><Checkbox checked={filteredProducts.data.length ? filteredProducts.data.every(p => selected.has(p.product_id!)) : false} onCheckedChange={toggleSelectAll} /></TableHead>
                  <TableHead>Name</TableHead><TableHead>SKU</TableHead><TableHead className="text-right">Stock</TableHead><TableHead className="text-right">Unit Price</TableHead><TableHead className="text-right">Total Value</TableHead><TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.data.map(p => (
                  <TableRow key={p.product_id} data-state={selected.has(p.product_id!) ? "selected" : undefined}>
                    <TableCell><Checkbox checked={selected.has(p.product_id!)} onCheckedChange={() => { setSelected(prev => { const n = new Set(prev); n.has(p.product_id!) ? n.delete(p.product_id!) : n.add(p.product_id!); return n; }); }} /></TableCell>
                    <TableCell className="font-medium truncate max-w-[200px]">{p.product_name}</TableCell>
                    <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                    <TableCell className="text-right font-mono">{p.total_inventory}</TableCell>
                    <TableCell className="text-right font-mono">{p.min_current_price ? formatCurrency(p.min_current_price) : '-'}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {p.min_current_price && p.total_inventory ? formatCurrency(p.min_current_price * p.total_inventory) : '-'}
                    </TableCell>
                    <TableCell><Badge variant={p.discount_status === 'discounted' ? 'default' : 'secondary'}>{p.discount_status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {totalPages > 1 && (
              <div className="flex justify-end gap-1 mt-3">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
                <span className="text-sm flex items-center px-2">{page + 1}/{totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Campaign Preview</DialogTitle></DialogHeader>
          {preview && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-muted p-2 rounded">Eligible: <strong className="text-emerald-600">{String(preview.eligible_variants)}</strong></div>
                <div className="bg-muted p-2 rounded">Total Variants: <strong>{String(preview.total_variants)}</strong></div>
                <div className={`p-2 rounded col-span-2 ${Number(preview.skipped_variants) > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-muted'}`}>
                  <span className={Number(preview.skipped_variants) > 0 ? 'text-amber-700' : ''}>
                    {Number(preview.skipped_variants) > 0 ? '⚠ ' : ''}Skipped (already discounted): <strong>{String(preview.skipped_variants)}</strong>
                  </span>
                  {Number(preview.skipped_variants) > 0 && !overwrite && (
                    <div className="mt-2 flex items-center gap-2">
                      <Switch checked={overwrite} onCheckedChange={v => { setOverwrite(v); handlePreview(v); }} id="overwrite-preview" />
                      <label htmlFor="overwrite-preview" className="text-xs text-amber-700 cursor-pointer">Enable Overwrite to include these {String(preview.skipped_variants)} skipped products</label>
                    </div>
                  )}
                  {Number(preview.skipped_variants) > 0 && overwrite && (
                    <p className="mt-1 text-xs text-emerald-700">✓ Overwrite enabled — all products will be included</p>
                  )}
                </div>
              </div>
              {Number(preview.eligible_variants) === 0 && (
                <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
                  ✗ No eligible products — all {String(preview.already_discounted)} selected variants are already discounted and Overwrite is off.
                  Enable Overwrite above to proceed.
                </div>
              )}
              {Array.isArray(preview.sample_preview) && (preview.sample_preview as Record<string, unknown>[]).length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Sample of eligible products:</p>
                  <Table>
                    <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead className="text-right">Current</TableHead><TableHead className="text-right">New</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(preview.sample_preview as Record<string, unknown>[]).map((s, i) => (
                        <TableRow key={i}>
                          <TableCell>{String(s.product_name)}</TableCell>
                          <TableCell className="font-mono text-xs">{String(s.variant_sku)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(Number(s.current_price))}</TableCell>
                          <TableCell className="text-right font-medium text-emerald-600">{formatCurrency(Number(s.new_price))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Cancel</Button>
            <Button onClick={handleSync} disabled={syncing || !canEdit || Number(preview?.eligible_variants ?? 0) === 0}>
              {syncing ? "Syncing..." : requireApproval ? "Confirm & Create Draft" : "Confirm & Sync"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
