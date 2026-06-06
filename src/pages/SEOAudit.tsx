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
import { exportToCSV } from "@/lib/export";
import { Search, Download, AlertCircle, CheckCircle2, Filter, RefreshCw } from "lucide-react";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import { useSEOSync } from "@/hooks/useSEOSync";
import { cn } from "@/lib/utils";

type ProductRow = {
  product_id: string;
  product_name: string;
  sku: string;
  collection_name: string | null;
  product_type: string | null;
  vendor_name: string | null;
  total_inventory: number;
  meta_title: string | null;
  meta_description: string | null;
  image_alt_text: string | null;
};

type IssueKey = "no_collection" | "no_type" | "no_vendor" | "no_meta_title" | "no_meta_description" | "no_alt_text" | "short_name" | "long_name";

const ISSUE_LABELS: Record<IssueKey, string> = {
  no_collection:     "No Collection",
  no_type:           "No Product Type",
  no_vendor:         "No Vendor",
  no_meta_title:     "No SEO Title",
  no_meta_description: "No SEO Description",
  no_alt_text:       "No Image Alt",
  short_name:        "Short Name (<20)",
  long_name:         "Long Name (>150)",
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
};

function getIssues(row: ProductRow): IssueKey[] {
  const issues: IssueKey[] = [];
  if (!row.collection_name)                   issues.push("no_collection");
  if (!row.product_type?.trim())              issues.push("no_type");
  if (!row.vendor_name)                       issues.push("no_vendor");
  if (!row.meta_title?.trim())               issues.push("no_meta_title");
  if (!row.meta_description?.trim())         issues.push("no_meta_description");
  if (!row.image_alt_text?.trim())           issues.push("no_alt_text");
  if (row.product_name.length < 20)          issues.push("short_name");
  if (row.product_name.length > 150)         issues.push("long_name");
  return issues;
}

const ALL_ISSUES = Object.keys(ISSUE_LABELS) as IssueKey[];
const FILTER_OPTIONS: (IssueKey | "all")[] = ["all", ...ALL_ISSUES];

export default function SEOAudit() {
  const { storeId } = useStoreFilter();
  const [issueFilter, setIssueFilter] = useState<IssueKey | "all">("all");
  const [search, setSearch] = useState("");
  const { sync: handleSyncSEO, syncing, percent, label: syncLabel } = useSEOSync(storeId);

  const { data, isLoading } = useQuery({
    queryKey: ["seo-audit", storeId],
    queryFn: async () => {
      let q = (supabase as any)
        .from("v_seo_audit")
        .select("product_id, product_name, sku, collection_name, product_type, vendor_name, total_inventory, meta_title, meta_description, image_alt_text")
        .order("product_name", { ascending: true })
        .limit(2000);
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ProductRow[];
    },
  });

  const enriched = useMemo(() => (data ?? []).map(r => ({ ...r, issues: getIssues(r) })), [data]);
  const withIssues = enriched.filter(r => r.issues.length > 0);

  const issueCounts = useMemo(() =>
    ALL_ISSUES.reduce((acc, key) => ({
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

  const hasSEOData = data?.some(r => r.meta_title || r.meta_description || r.image_alt_text);
  const healthScore = data?.length
    ? Math.round(((data.length - withIssues.length) / data.length) * 100)
    : 100;

  if (isLoading) return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">{[1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );

  return (
    <div className="space-y-6">

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
            <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing SEO…" : "Sync SEO from Shopify"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => filtered.length && exportToCSV(
            filtered.map(r => ({
              Product: r.product_name,
              SKU: r.sku,
              Collection: r.collection_name ?? "",
              "Product Type": r.product_type ?? "",
              Vendor: r.vendor_name ?? "",
              "SEO Title": r.meta_title ?? "",
              "SEO Description": r.meta_description ?? "",
              "Image Alt": r.image_alt_text ?? "",
              "Name Length": r.product_name.length,
              Inventory: r.total_inventory,
              Issues: r.issues.map(i => ISSUE_LABELS[i]).join("; "),
            })),
            "seo-audit"
          )}>
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
        </div>
      </div>

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

      {!syncing && !hasSEOData && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 flex items-center gap-3 text-sm">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-amber-800 dark:text-amber-300">
            SEO fields (meta title, description, image alt) are not synced yet.
            Click <strong>Sync SEO from Shopify</strong> to pull them from your store.
          </span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className={cn("p-2 rounded-lg shrink-0", healthScore >= 80 ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-red-50 dark:bg-red-950/30")}>
              <CheckCircle2 className={cn("h-4 w-4", healthScore >= 80 ? "text-emerald-500" : "text-red-500")} />
            </div>
            <div>
              <div className={cn("text-2xl font-bold", healthScore >= 80 ? "text-emerald-600" : "text-red-600")}>
                {healthScore}%
              </div>
              <div className="text-xs text-muted-foreground">Catalog health score</div>
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
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTER_OPTIONS.map(f => (
          <Button
            key={f}
            variant={issueFilter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setIssueFilter(f)}
            className="text-xs"
          >
            {f === "all" ? `All Issues (${withIssues.length})` : `${ISSUE_LABELS[f]} (${issueCounts[f]})`}
          </Button>
        ))}
      </div>

      <Input
        placeholder="Search by name or SKU..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="max-w-sm"
      />

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
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Collection</TableHead>
                <TableHead>SEO Title</TableHead>
                <TableHead>SEO Desc.</TableHead>
                <TableHead>Alt Text</TableHead>
                <TableHead>Issues</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(r => (
                <TableRow key={r.product_id}>
                  <TableCell className="font-medium max-w-[180px] truncate" title={r.product_name}>
                    {r.product_name}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                  <TableCell className={cn("text-sm max-w-[120px] truncate", !r.collection_name ? "text-red-500 italic" : "text-muted-foreground")}>
                    {r.collection_name ?? "Missing"}
                  </TableCell>
                  <TableCell className={cn("text-sm max-w-[140px] truncate", !r.meta_title ? "text-rose-500 italic" : "text-muted-foreground")} title={r.meta_title ?? ""}>
                    {r.meta_title ?? "Missing"}
                  </TableCell>
                  <TableCell className={cn("text-sm max-w-[140px] truncate", !r.meta_description ? "text-pink-500 italic" : "text-muted-foreground")} title={r.meta_description ?? ""}>
                    {r.meta_description ?? "Missing"}
                  </TableCell>
                  <TableCell className={cn("text-sm max-w-[120px] truncate", !r.image_alt_text ? "text-purple-500 italic" : "text-muted-foreground")} title={r.image_alt_text ?? ""}>
                    {r.image_alt_text ?? "Missing"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1 min-w-[120px]">
                      {r.issues.map(issue => (
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
