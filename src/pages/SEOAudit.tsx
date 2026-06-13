import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { exportToCSV } from "@/lib/export";
import { toast } from "sonner";
import {
  Search, Download, AlertCircle, CheckCircle2, Filter, RefreshCw,
  Pencil, Sparkles, Tag, Copy, X, Loader2,
} from "lucide-react";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import { useSEOSync } from "@/hooks/useSEOSync";
import { useSEOActions, type AIResult, type SEOFieldUpdate } from "@/hooks/useSEOActions";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProductRow = {
  product_id: string;
  product_name: string;
  sku: string;
  collection_name: string | null;
  product_type: string | null;
  vendor_name: string | null;
  total_inventory: number;
  store_id: string;
  meta_title: string | null;
  meta_description: string | null;
  image_alt_text: string | null;
};

type IssueKey =
  | "no_collection" | "no_type" | "no_vendor"
  | "no_meta_title" | "no_meta_description" | "no_alt_text"
  | "short_name" | "long_name" | "duplicate_title"
  | "title_too_short" | "title_too_long" | "desc_too_short" | "desc_too_long";

type EditFields = {
  meta_title: string;
  meta_description: string;
  image_alt_text: string;
  product_type: string;
};

// ─── Issue config ─────────────────────────────────────────────────────────────

const ISSUE_LABELS: Record<IssueKey, string> = {
  no_collection:       "No Collection",
  no_type:             "No Product Type",
  no_vendor:           "No Vendor",
  no_meta_title:       "No SEO Title",
  no_meta_description: "No SEO Description",
  no_alt_text:         "No Image Alt",
  short_name:          "Short Name (<20)",
  long_name:           "Long Name (>150)",
  duplicate_title:     "Duplicate SEO Title",
  title_too_short:     "SEO Title Too Short",
  title_too_long:      "SEO Title Too Long",
  desc_too_short:      "SEO Desc Too Short",
  desc_too_long:       "SEO Desc Too Long",
};

const ISSUE_COLORS: Record<IssueKey, string> = {
  no_collection:       "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400",
  no_type:             "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400",
  no_vendor:           "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400",
  no_meta_title:       "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400",
  no_meta_description: "bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/30 dark:text-pink-400",
  no_alt_text:         "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400",
  short_name:          "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400",
  long_name:           "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800/40 dark:text-slate-400",
  duplicate_title:     "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400",
  title_too_short:     "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-400",
  title_too_long:      "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-400",
  desc_too_short:      "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-400",
  desc_too_long:       "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-400",
};

// Issues shown in filter tabs (primary ones)
const FILTER_ISSUE_KEYS: IssueKey[] = [
  "no_collection", "no_type", "no_vendor",
  "no_meta_title", "no_meta_description", "no_alt_text",
  "short_name", "long_name", "duplicate_title",
];

function getIssues(row: ProductRow, dupTitles: Set<string>): IssueKey[] {
  const issues: IssueKey[] = [];
  if (!row.collection_name)             issues.push("no_collection");
  if (!row.product_type?.trim())        issues.push("no_type");
  if (!row.vendor_name)                 issues.push("no_vendor");

  if (!row.meta_title?.trim()) {
    issues.push("no_meta_title");
  } else {
    if (dupTitles.has(row.meta_title.toLowerCase().trim())) issues.push("duplicate_title");
    if (row.meta_title.length < 40)  issues.push("title_too_short");
    if (row.meta_title.length > 65)  issues.push("title_too_long");
  }

  if (!row.meta_description?.trim()) {
    issues.push("no_meta_description");
  } else {
    if (row.meta_description.length < 100) issues.push("desc_too_short");
    if (row.meta_description.length > 160) issues.push("desc_too_long");
  }

  if (!row.image_alt_text?.trim())      issues.push("no_alt_text");
  if (row.product_name.length < 20)     issues.push("short_name");
  if (row.product_name.length > 150)    issues.push("long_name");
  return issues;
}

// ─── Char counter helper ───────────────────────────────────────────────────────

function CharCount({ value, min, max }: { value: string; min: number; max: number }) {
  const len = value.length;
  const cls =
    len === 0 ? "text-muted-foreground" :
    len >= min && len <= max ? "text-emerald-600 dark:text-emerald-400" :
    len < min * 0.7 || len > max * 1.2 ? "text-red-500" : "text-amber-500";
  return (
    <span className={cn("text-[10px] font-mono", cls)}>
      {len}/{max} {len >= min && len <= max ? "✓" : len > max ? "↑" : ""}
    </span>
  );
}

// ─── Edit Dialog ──────────────────────────────────────────────────────────────

function EditDialog({
  product,
  fields,
  onChange,
  onSave,
  onClose,
  saving,
}: {
  product: ProductRow;
  fields: EditFields;
  onChange: (f: Partial<EditFields>) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base truncate">{product.product_name}</DialogTitle>
          <p className="text-xs text-muted-foreground font-mono">{product.sku}</p>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Product Type */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Product Type</Label>
            </div>
            <Input
              value={fields.product_type}
              onChange={e => onChange({ product_type: e.target.value })}
              placeholder="e.g. Books, Quran, Islamic Studies"
              className="h-8 text-sm"
            />
          </div>

          {/* SEO Title */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">SEO Title</Label>
              <CharCount value={fields.meta_title} min={50} max={60} />
            </div>
            <Input
              value={fields.meta_title}
              onChange={e => onChange({ meta_title: e.target.value })}
              placeholder="50–60 characters recommended"
              className="h-8 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">Optimal: 50–60 chars</p>
          </div>

          {/* SEO Description */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">SEO Description</Label>
              <CharCount value={fields.meta_description} min={120} max={155} />
            </div>
            <Textarea
              value={fields.meta_description}
              onChange={e => onChange({ meta_description: e.target.value })}
              placeholder="120–155 characters recommended"
              rows={3}
              className="text-sm resize-none"
            />
            <p className="text-[10px] text-muted-foreground">Optimal: 120–155 chars</p>
          </div>

          {/* Image Alt Text */}
          <div className="space-y-1">
            <Label className="text-xs">Image Alt Text</Label>
            <Input
              value={fields.image_alt_text}
              onChange={e => onChange({ image_alt_text: e.target.value })}
              placeholder="Descriptive alt text for featured image"
              className="h-8 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">Saved to DB only — pushed to Shopify on next full sync</p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={onSave} disabled={saving}>
            {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Saving…</> : "Save & Push to Shopify"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk Product Type Dialog ─────────────────────────────────────────────────

function BulkProductTypeDialog({
  count,
  value,
  onChange,
  onApply,
  onClose,
  saving,
}: {
  count: number;
  value: string;
  onChange: (v: string) => void;
  onApply: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Set Product Type</DialogTitle>
          <p className="text-sm text-muted-foreground">Apply to {count} selected product{count !== 1 ? "s" : ""}</p>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label className="text-xs">Product Type</Label>
          <Input
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="e.g. Books, Quran, Islamic Studies"
            className="h-8 text-sm"
            autoFocus
            onKeyDown={e => e.key === "Enter" && value.trim() && onApply()}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={onApply} disabled={!value.trim() || saving}>
            {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Saving…</> : "Apply to Shopify"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── AI Preview Dialog ────────────────────────────────────────────────────────

function AIPreviewDialog({
  results,
  onChange,
  onConfirm,
  onClose,
  saving,
}: {
  results: AIResult[];
  onChange: (idx: number, field: "meta_title" | "meta_description", value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" /> AI Generated SEO
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Review and edit before saving. {results.length} product{results.length !== 1 ? "s" : ""}.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
          {results.map((r, idx) => (
            <div key={r.product_id} className="border rounded-lg p-3 space-y-3">
              <p className="text-xs font-medium truncate text-muted-foreground">{r.product_name}</p>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">SEO Title</Label>
                  <CharCount value={r.meta_title} min={50} max={60} />
                </div>
                <Input
                  value={r.meta_title}
                  onChange={e => onChange(idx, "meta_title", e.target.value)}
                  className="h-8 text-sm"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">SEO Description</Label>
                  <CharCount value={r.meta_description} min={120} max={155} />
                </div>
                <Textarea
                  value={r.meta_description}
                  onChange={e => onChange(idx, "meta_description", e.target.value)}
                  rows={2}
                  className="text-sm resize-none"
                />
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2 pt-2 border-t">
          <Button variant="ghost" size="sm" onClick={onClose}>Discard</Button>
          <Button size="sm" onClick={onConfirm} disabled={saving}>
            {saving
              ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Saving…</>
              : `Save & Push ${results.length} to Shopify`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SEOAudit() {
  const { storeId } = useStoreFilter();

  // Filters
  const [issueFilter, setIssueFilter] = useState<IssueKey | "all">("all");
  const [search, setSearch]           = useState("");

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Edit dialog
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [editFields, setEditFields] = useState<EditFields>({
    meta_title: "", meta_description: "", image_alt_text: "", product_type: "",
  });

  // Bulk dialogs
  const [bulkTypeOpen, setBulkTypeOpen] = useState(false);
  const [bulkTypeValue, setBulkTypeValue] = useState("");

  // AI preview
  const [aiResults, setAiResults]     = useState<AIResult[]>([]);
  const [aiPreviewOpen, setAiPreviewOpen] = useState(false);

  const { sync: handleSyncSEO, syncing, percent, label: syncLabel } = useSEOSync(storeId);
  const { saving, aiGenerating, saveProduct, bulkSave, generateAISEO } = useSEOActions(storeId);

  // ── Data ──────────────────────────────────────────────────────────────────

  const { data, isLoading } = useQuery({
    queryKey: ["seo-audit", storeId],
    queryFn: async () => {
      let q = (supabase as any)
        .from("v_seo_audit")
        .select("product_id, product_name, sku, collection_name, product_type, vendor_name, total_inventory, store_id, meta_title, meta_description, image_alt_text")
        .order("product_name", { ascending: true })
        .limit(10000);
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ProductRow[];
    },
  });

  // Duplicate title detection + issue enrichment
  const enriched = useMemo(() => {
    const titleCounts = new Map<string, number>();
    (data ?? []).forEach(r => {
      const k = r.meta_title?.toLowerCase().trim();
      if (k) titleCounts.set(k, (titleCounts.get(k) ?? 0) + 1);
    });
    const dupTitles = new Set([...titleCounts.entries()].filter(([, c]) => c > 1).map(([t]) => t));
    return (data ?? []).map(r => ({ ...r, issues: getIssues(r, dupTitles) }));
  }, [data]);

  const withIssues = enriched.filter(r => r.issues.length > 0);

  const issueCounts = useMemo(() =>
    FILTER_ISSUE_KEYS.reduce((acc, key) => ({
      ...acc,
      [key]: withIssues.filter(r => r.issues.includes(key)).length,
    }), {} as Record<IssueKey, number>),
  [withIssues]);

  const filtered = useMemo(() => {
    let rows = withIssues;
    if (issueFilter !== "all") rows = rows.filter(r => r.issues.includes(issueFilter));
    if (search) rows = rows.filter(r =>
      r.product_name.toLowerCase().includes(search.toLowerCase()) ||
      r.sku?.toLowerCase().includes(search.toLowerCase())
    );
    return rows;
  }, [withIssues, issueFilter, search]);

  const totalIssueCount = useMemo(() =>
    withIssues.reduce((sum, r) => sum + r.issues.length, 0),
  [withIssues]);

  const hasSEOData = data?.some(r => r.meta_title || r.meta_description || r.image_alt_text);
  const healthScore = data?.length
    ? Math.round(((data.length - withIssues.length) / data.length) * 100)
    : 100;

  // ── Selection helpers ─────────────────────────────────────────────────────

  const filteredSelected = filtered.filter(r => selectedIds.has(r.product_id));
  const allSelected = filtered.length > 0 && filteredSelected.length === filtered.length;
  const someSelected = filteredSelected.length > 0;

  const toggleAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) filtered.forEach(r => next.delete(r.product_id));
      else             filtered.forEach(r => next.add(r.product_id));
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleOpenEdit = (row: ProductRow) => {
    setEditingProduct(row);
    setEditFields({
      meta_title:       row.meta_title       ?? "",
      meta_description: row.meta_description ?? "",
      image_alt_text:   row.image_alt_text   ?? "",
      product_type:     row.product_type     ?? "",
    });
  };

  const handleSaveEdit = async () => {
    if (!editingProduct) return;
    const fields: SEOFieldUpdate = {
      meta_title:       editFields.meta_title       || null,
      meta_description: editFields.meta_description || null,
      image_alt_text:   editFields.image_alt_text   || null,
      product_type:     editFields.product_type     || null,
    };
    const ok = await saveProduct(editingProduct.product_id, fields);
    if (ok) setEditingProduct(null);
  };

  const handleBulkAltText = async () => {
    if (!filteredSelected.length) return;
    await bulkSave(filteredSelected.map(r => ({
      product_id: r.product_id,
      fields: { image_alt_text: r.product_name },
    })));
    clearSelection();
  };

  const handleBulkProductType = async () => {
    if (!filteredSelected.length || !bulkTypeValue.trim()) return;
    await bulkSave(
      filteredSelected.map(r => ({ product_id: r.product_id, fields: { product_type: bulkTypeValue.trim() } })),
      true,
    );
    setBulkTypeOpen(false);
    setBulkTypeValue("");
    clearSelection();
  };

  const handleGenerateAI = async () => {
    if (!filteredSelected.length) return;
    const results = await generateAISEO(filteredSelected.map(r => ({
      product_id:      r.product_id,
      product_name:    r.product_name,
      collection_name: r.collection_name,
      product_type:    r.product_type,
      vendor_name:     r.vendor_name,
    })));
    if (results.length > 0) {
      setAiResults(results);
      setAiPreviewOpen(true);
    }
  };

  const handleConfirmAI = async () => {
    await bulkSave(
      aiResults.map(r => ({
        product_id: r.product_id,
        fields: { meta_title: r.meta_title, meta_description: r.meta_description },
      })),
      true,
    );
    setAiPreviewOpen(false);
    setAiResults([]);
    clearSelection();
  };

  const handleUpdateAIResult = (idx: number, field: "meta_title" | "meta_description", value: string) => {
    setAiResults(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">{[1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Search className="h-6 w-6" /> SEO Audit
          </h1>
          <p className="text-sm text-muted-foreground">
            Products missing SEO title, description, alt text, collection, type, or vendor
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSyncSEO} disabled={syncing}>
            <RefreshCw className={cn("h-4 w-4 mr-1", syncing && "animate-spin")} />
            {syncing ? "Syncing…" : "Sync from Shopify"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => filtered.length && exportToCSV(
            filtered.map(r => ({
              Product: r.product_name, SKU: r.sku,
              Collection: r.collection_name ?? "",
              "Product Type": r.product_type ?? "",
              Vendor: r.vendor_name ?? "",
              "SEO Title": r.meta_title ?? "",
              "SEO Description": r.meta_description ?? "",
              "Image Alt": r.image_alt_text ?? "",
              "Name Length": r.product_name.length,
              Issues: (r as any).issues?.map((i: IssueKey) => ISSUE_LABELS[i]).join("; ") ?? "",
            })),
            "seo-audit"
          )}>
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
        </div>
      </div>

      {/* Sync progress */}
      {syncing && (
        <div className="rounded-lg border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              {syncLabel || "Syncing SEO data from Shopify…"}
            </span>
            <span className="font-mono font-medium">{percent}%</span>
          </div>
          <Progress value={percent} className="h-2" />
        </div>
      )}

      {/* No SEO data warning */}
      {!syncing && !hasSEOData && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 flex items-center gap-3 text-sm">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-amber-800 dark:text-amber-300">
            SEO fields are not synced yet. Click <strong>Sync from Shopify</strong> to pull them.
          </span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className={cn("p-2 rounded-lg shrink-0", healthScore >= 80 ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-red-50 dark:bg-red-950/30")}>
              <CheckCircle2 className={cn("h-4 w-4", healthScore >= 80 ? "text-emerald-500" : "text-red-500")} />
            </div>
            <div>
              <div className={cn("text-2xl font-bold", healthScore >= 80 ? "text-emerald-600" : "text-red-600")}>
                {healthScore}%
              </div>
              <div className="text-xs text-muted-foreground">Catalog health</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/30 shrink-0">
              <AlertCircle className="h-4 w-4 text-red-500" />
            </div>
            <div>
              <div className="text-2xl font-bold">{withIssues.length}</div>
              <div className="text-xs text-muted-foreground">Products with issues</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/30 shrink-0">
              <Filter className="h-4 w-4 text-rose-500" />
            </div>
            <div>
              <div className="text-2xl font-bold">{issueCounts.no_meta_title}</div>
              <div className="text-xs text-muted-foreground">Missing SEO title</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-yellow-50 dark:bg-yellow-950/30 shrink-0">
              <Copy className="h-4 w-4 text-yellow-500" />
            </div>
            <div>
              <div className="text-2xl font-bold">{issueCounts.duplicate_title}</div>
              <div className="text-xs text-muted-foreground">Duplicate SEO titles</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={issueFilter === "all" ? "default" : "outline"}
          size="sm"
          onClick={() => setIssueFilter("all")}
          className="text-xs"
        >
          All Issues ({withIssues.length})
        </Button>
        {FILTER_ISSUE_KEYS.filter(k => issueCounts[k] > 0).map(f => (
          <Button
            key={f}
            variant={issueFilter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setIssueFilter(f)}
            className="text-xs"
          >
            {ISSUE_LABELS[f]} ({issueCounts[f]})
          </Button>
        ))}
      </div>

      {/* Search + bulk toolbar */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search by name or SKU…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm h-8 text-sm"
        />

        {someSelected && (
          <div className="flex items-center gap-2 ml-auto bg-muted/50 border rounded-lg px-3 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {filteredSelected.length} selected
            </span>
            <div className="w-px h-4 bg-border" />
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs px-2"
              onClick={handleBulkAltText}
              disabled={saving}
              title="Set alt text = product name for selected"
            >
              <Tag className="h-3 w-3 mr-1" /> Set Alt Text
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs px-2"
              onClick={() => setBulkTypeOpen(true)}
              disabled={saving}
            >
              <Filter className="h-3 w-3 mr-1" /> Set Type
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs px-2 text-purple-600 hover:text-purple-700 dark:text-purple-400"
              onClick={handleGenerateAI}
              disabled={aiGenerating || saving}
            >
              {aiGenerating
                ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Generating…</>
                : <><Sparkles className="h-3 w-3 mr-1" /> AI Generate SEO</>}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={clearSelection}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      {!filtered.length ? (
        <div className="text-center py-16 text-muted-foreground">
          <CheckCircle2 className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p className="font-medium">No issues found</p>
          <p className="text-xs mt-1">All products pass this filter</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>SEO Title</TableHead>
                <TableHead>SEO Desc.</TableHead>
                <TableHead>Alt Text</TableHead>
                <TableHead>Issues</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(r => (
                <TableRow
                  key={r.product_id}
                  className={cn(selectedIds.has(r.product_id) && "bg-muted/30")}
                >
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(r.product_id)}
                      onCheckedChange={() => toggleOne(r.product_id)}
                      aria-label={`Select ${r.product_name}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium max-w-[180px]">
                    <span className="truncate block" title={r.product_name}>
                      {r.product_name}
                    </span>
                    {r.issues.includes("short_name") && (
                      <span className="text-[9px] text-blue-500 font-mono">{r.product_name.length} chars</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.sku}</TableCell>
                  <TableCell className={cn("text-xs max-w-[100px] truncate", !r.product_type ? "text-orange-500 italic" : "text-muted-foreground")}>
                    {r.product_type ?? "Missing"}
                  </TableCell>
                  <TableCell className="max-w-[150px]">
                    {r.meta_title ? (
                      <span
                        className={cn(
                          "text-xs truncate block",
                          r.issues.includes("duplicate_title") ? "text-yellow-600" :
                          r.issues.includes("title_too_short") || r.issues.includes("title_too_long") ? "text-amber-500" :
                          "text-muted-foreground"
                        )}
                        title={`${r.meta_title} (${r.meta_title.length} chars)`}
                      >
                        {r.meta_title}
                        <span className="text-[9px] font-mono ml-1 opacity-60">{r.meta_title.length}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-rose-500 italic">Missing</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[140px]">
                    {r.meta_description ? (
                      <span
                        className={cn(
                          "text-xs truncate block",
                          r.issues.includes("desc_too_short") || r.issues.includes("desc_too_long") ? "text-amber-500" : "text-muted-foreground"
                        )}
                        title={`${r.meta_description} (${r.meta_description.length} chars)`}
                      >
                        {r.meta_description}
                        <span className="text-[9px] font-mono ml-1 opacity-60">{r.meta_description.length}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-pink-500 italic">Missing</span>
                    )}
                  </TableCell>
                  <TableCell className={cn("text-xs max-w-[120px] truncate", !r.image_alt_text ? "text-purple-500 italic" : "text-muted-foreground")} title={r.image_alt_text ?? ""}>
                    {r.image_alt_text ?? "Missing"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1 min-w-[120px]">
                      {r.issues
                        .filter(i => FILTER_ISSUE_KEYS.includes(i))
                        .map(issue => (
                          <Badge
                            key={issue}
                            variant="outline"
                            className={cn("text-[10px] px-1.5 py-0", ISSUE_COLORS[issue])}
                          >
                            {ISSUE_LABELS[issue]}
                          </Badge>
                        ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => handleOpenEdit(r)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Dialogs */}
      {editingProduct && (
        <EditDialog
          product={editingProduct}
          fields={editFields}
          onChange={f => setEditFields(prev => ({ ...prev, ...f }))}
          onSave={handleSaveEdit}
          onClose={() => setEditingProduct(null)}
          saving={saving}
        />
      )}

      {bulkTypeOpen && (
        <BulkProductTypeDialog
          count={filteredSelected.length}
          value={bulkTypeValue}
          onChange={setBulkTypeValue}
          onApply={handleBulkProductType}
          onClose={() => { setBulkTypeOpen(false); setBulkTypeValue(""); }}
          saving={saving}
        />
      )}

      {aiPreviewOpen && (
        <AIPreviewDialog
          results={aiResults}
          onChange={handleUpdateAIResult}
          onConfirm={handleConfirmAI}
          onClose={() => { setAiPreviewOpen(false); setAiResults([]); }}
          saving={saving}
        />
      )}
    </div>
  );
}
