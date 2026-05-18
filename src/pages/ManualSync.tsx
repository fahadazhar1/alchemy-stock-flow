import { useState, useMemo } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/useCurrency";
import { RefreshCw, Eye, Zap, Filter, ChevronDown, X } from "lucide-react";
import { Json } from "@/integrations/supabase/types";
import { DateRangeFilter, matchesDateFilter } from "@/components/DateRangeFilter";
import { useStoreFilter } from "@/hooks/useStoreFilter";

const PAGE_SIZE = 20;

export default function ManualSync() {
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
  const [filterDates, setFilterDates] = useState<Date[]>([]);
  const [filterMonths, setFilterMonths] = useState<number[]>([]);
  const [filterYears, setFilterYears] = useState<number[]>([]);
  const hasDateFilter = filterDates.length > 0 || filterMonths.length > 0 || filterYears.length > 0;

  const { data: collections } = useQuery({
    queryKey: ["sync-collections"],
    queryFn: async () => {
      const { data } = await supabase.from("collections").select("id, name").order("name");
      return data ?? [];
    },
  });

  const { data: vendors } = useQuery({
    queryKey: ["sync-vendors"],
    queryFn: async () => {
      const { data } = await supabase.from("vendors").select("id, name").order("name");
      return data ?? [];
    },
  });

  const { data: productTypes } = useQuery({
    queryKey: ["sync-product-types"],
    queryFn: async () => {
      const { data } = await supabase.from("v_product_inventory_summary").select("product_type");
      return [...new Set((data ?? []).map(d => d.product_type).filter(Boolean))].sort();
    },
  });

  const { data: products } = useQuery({
    queryKey: ["sync-products", page, search, collectionFilter, vendorFilter, typeFilter, storeId],
    queryFn: async () => {
      try {
        let q = supabase.from("v_product_inventory_summary").select("*", { count: "exact" });
        if (storeId) q = q.eq("store_id", storeId);
        if (search) q = q.or(`product_name.ilike.%${search}%,sku.ilike.%${search}%`);
        if (collectionFilter !== "all") q = q.eq("collection_name", collectionFilter);
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
      const { data } = await supabase.from("app_settings").select("*").eq("setting_key", "pricing_config").single();
      return data?.setting_value as Record<string, unknown> | null;
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
      let q = supabase.from("v_product_inventory_summary").select("product_id");
      if (storeId) q = q.eq("store_id", storeId);
      if (filterType === "collection") q = q.eq("collection_name", filterValue);
      else if (filterType === "vendor") q = q.eq("vendor_name", filterValue);
      else if (filterType === "type") q = q.eq("product_type", filterValue);
      const { data, error } = await q;
      if (error) throw error;
      const ids = (data ?? []).map(p => p.product_id).filter(Boolean) as string[];
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
      // Deselect products that belong only to this collection
      try {
        let dq = supabase.from("v_product_inventory_summary").select("product_id").eq("collection_name", collectionName);
        if (storeId) dq = dq.eq("store_id", storeId);
        const { data } = await dq;
        const ids = (data ?? []).map(p => p.product_id).filter(Boolean) as string[];
        setSelected(prev => {
          const n = new Set(prev);
          ids.forEach(id => n.delete(id));
          return n;
        });
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

  const handlePreview = async () => {
    if (isAllStores) { toast.error("Select a specific store before previewing a campaign"); return; }
    if (!selected.size) { toast.error("Select products first"); return; }
    if (!campaignName.trim()) { toast.error("Campaign name is required"); return; }
    if (!discountPercent && !fixedPrice) { toast.error("Enter discount % or fixed price"); return; }
    try {
      const { data, error } = await supabase.rpc("preview_bulk_discount", {
        p_product_ids: Array.from(selected),
        p_discount_percent: discountPercent ? Number(discountPercent) : null,
        p_fixed_price: fixedPrice ? Number(fixedPrice) : null,
        p_overwrite_existing: overwrite,
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
      const { error } = await supabase.rpc("create_campaign_draft", {
        p_product_ids: ids,
        p_discount_percent: discountPercent ? Number(discountPercent) : null,
        p_fixed_price: fixedPrice ? Number(fixedPrice) : null,
        p_campaign_name: campaignName, p_overwrite_existing: overwrite,
        p_rounding_mode: roundingMode, p_source: "manual",
        p_store_id: storeId,
      });
      if (error) throw error;
      toast.success("Campaign draft created — pending approval");
      if (isAllStores) {
        toast.info("Draft created without a specific store selected.");
      }
    } else {
      // Step 1: Apply in DB
      const { data: result, error } = await supabase.rpc("apply_bulk_discount", {
        p_product_ids: ids,
        p_discount_percent: discountPercent ? Number(discountPercent) : null,
        p_fixed_price: fixedPrice ? Number(fixedPrice) : null,
        p_campaign_name: campaignName, p_overwrite_existing: overwrite,
        p_rounding_mode: roundingMode,
      });
      if (error) throw error;

      // Step 2: Push to Shopify
      const campaignId = (result as any)?.campaign_id;
      if (campaignId) {
        const { data: syncResult, error: syncErr } = await supabase.functions.invoke("shopify-sync", {
          body: { action: "push_prices", campaign_id: campaignId }
        });
        if (syncErr) throw syncErr;
        if (!syncResult?.ok) throw new Error(syncResult?.error || "Shopify push failed");
        toast.success("Pricing synced to Shopify successfully!");
      } else {
        toast.success("Pricing applied in DB (no Shopify push — campaign ID missing)");
      }
    }
    queryClient.invalidateQueries();
    setPreviewOpen(false); setSelected(new Set()); setCampaignName(""); setDiscountPercent(""); setFixedPrice("");
  } catch (e: any) { toast.error(e?.message || "Sync failed"); } finally { setSyncing(false); }
};

  const canSync = !isAllStores && campaignName.trim() && (discountPercent || fixedPrice) && selected.size > 0;
  const preview = previewData as Record<string, unknown> | null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><RefreshCw className="h-6 w-6" /> Manual Sync</h1>
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
              <Select value={roundingMode} onValueChange={setRoundingMode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="whole">Whole Numbers</SelectItem><SelectItem value=".00">.00</SelectItem><SelectItem value=".99">.99</SelectItem></SelectContent></Select>
            </div>
            <div className="flex items-center justify-between"><Label>Overwrite Existing</Label><Switch checked={overwrite} onCheckedChange={setOverwrite} /></div>
            <div className="border-t pt-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1"><Filter className="h-3 w-3" /> Quick Target by</p>
              <div className="space-y-2">
                {/* Multi-select Collections */}
                <Popover open={collectionPopoverOpen} onOpenChange={setCollectionPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-8 w-full text-xs justify-between font-normal">
                      {collectionTargets.size === 0
                        ? "+ Add Collection"
                        : collectionTargets.size === (collections?.length ?? 0)
                          ? "All Collections"
                          : `${collectionTargets.size} collection${collectionTargets.size > 1 ? "s" : ""} selected`}
                      <ChevronDown className="h-3 w-3 ml-1 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-2" align="start">
                    <ScrollArea className="max-h-56">
                      <div className="space-y-1">
                        {/* All Collections option */}
                        <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-xs font-semibold border-b pb-2 mb-1">
                          <Checkbox
                            checked={collectionTargets.size === (collections?.length ?? 0) && (collections?.length ?? 0) > 0}
                            onCheckedChange={checked => toggleAllCollections(!!checked)}
                          />
                          All Collections
                        </label>
                        {collections?.map(c => (
                          <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-xs">
                            <Checkbox
                              checked={collectionTargets.has(c.name)}
                              onCheckedChange={checked => toggleCollectionTarget(c.name, !!checked)}
                            />
                            {c.name}
                          </label>
                        ))}
                      </div>
                    </ScrollArea>
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
                <Select onValueChange={v => selectByFilter("vendor", v)}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="+ Add Vendor" /></SelectTrigger><SelectContent>{vendors?.map(v => <SelectItem key={v.id} value={v.name}>{v.name}</SelectItem>)}</SelectContent></Select>
                <Select onValueChange={v => selectByFilter("type", v)}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="+ Add Product Type" /></SelectTrigger><SelectContent>{productTypes?.map(t => <SelectItem key={t} value={t!}>{t}</SelectItem>)}</SelectContent></Select>
              </div>
            </div>
            <div className="pt-2 space-y-2">
              <Badge variant="secondary">{selected.size} products selected</Badge>
              {isAllStores && <p className="text-xs text-red-600 font-medium">⚠ Select a specific store to enable campaigns</p>}
              {requireApproval && !isAllStores && <p className="text-xs text-amber-600">⚠ Approval required before live execution</p>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={handlePreview} disabled={!canSync}><Eye className="h-4 w-4 mr-1" /> Preview</Button>
              <Button className="flex-1" onClick={handleSync} disabled={!canSync || syncing}><Zap className="h-4 w-4 mr-1" /> {requireApproval ? "Create Draft" : "Sync"}</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Select Products</CardTitle>
              <div className="flex gap-2">
                <Select value={collectionFilter} onValueChange={v => { setCollectionFilter(v); setPage(0); }}><SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Collection" /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem>{collections?.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}</SelectContent></Select>
                <Select value={vendorFilter} onValueChange={v => { setVendorFilter(v); setPage(0); }}><SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Vendor" /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem>{vendors?.map(v => <SelectItem key={v.id} value={v.name}>{v.name}</SelectItem>)}</SelectContent></Select>
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
          <DialogHeader><DialogTitle>Sync Preview</DialogTitle></DialogHeader>
          {preview && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-muted p-2 rounded">Eligible: <strong>{String(preview.eligible_variants)}</strong></div>
                <div className="bg-muted p-2 rounded">Skipped: <strong>{String(preview.skipped_variants)}</strong></div>
                <div className="bg-muted p-2 rounded">Already Discounted: <strong>{String(preview.already_discounted)}</strong></div>
                <div className="bg-muted p-2 rounded">Total Variants: <strong>{String(preview.total_variants)}</strong></div>
              </div>
              {Array.isArray(preview.sample_preview) && (preview.sample_preview as Record<string, unknown>[]).length > 0 && (
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
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Cancel</Button>
            <Button onClick={handleSync} disabled={syncing}>{syncing ? "Syncing..." : requireApproval ? "Create Draft" : "Confirm & Sync"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
