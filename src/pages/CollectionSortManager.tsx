import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/contexts/StoreContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  ArrowUpDown, GripVertical, Plus, X, CheckSquare, Square,
  AlertTriangle, ChevronRight, ChevronLeft, Loader2, ListOrdered,
} from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// ── Types ─────────────────────────────────────────────────────────────────────

interface ShopifyCollection {
  id: string;
  title: string;
  handle: string;
}

type SortRuleType = "language" | "stock" | "date";

interface SortRule {
  id: string;
  type: SortRuleType;
  value: string;
  priority?: number;
}

interface CollectionProgress {
  id: string;
  title: string;
  status: "pending" | "processing" | "done" | "failed";
  productsReordered?: number;
  error?: string;
}

interface RunSummary {
  collectionsTotal: number;
  collectionsSorted: number;
  totalProductsReordered: number;
  errors: Array<{ collectionId: string; title: string; error: string }>;
  runAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CANONICAL_LANGUAGES = [
  "Arabic", "Bengali", "English", "Farsi", "Filipino", "French",
  "Indonesian", "Nepali", "Spanish", "Swahili", "Urdu", "Uthmani",
];

const AUTO_EXCLUDE_PATTERNS = ["best-sellers", "best_sellers", "trending-now", "trending_now"];

function shouldAutoExclude(handle: string): boolean {
  const h = handle.toLowerCase();
  return AUTO_EXCLUDE_PATTERNS.some((p) => h.includes(p));
}

// ── Plain-English sort summary ────────────────────────────────────────────────

function buildSortSummary(rules: SortRule[]): string {
  const langRules = rules
    .filter((r) => r.type === "language")
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  const stockRule = rules.find((r) => r.type === "stock");
  const dateRule = rules.find((r) => r.type === "date");

  const inStockFirst = !stockRule || stockRule.value === "in_stock_first";
  const newestFirst = !dateRule || dateRule.value === "newest_first";

  const stockWord = inStockFirst ? "in-stock" : "out-of-stock";
  const dateWord = newestFirst ? "new arrivals" : "oldest arrivals";
  const otherStockWord = inStockFirst ? "out-of-stock" : "in-stock";

  const parts: string[] = [];

  if (langRules.length > 0) {
    for (const r of langRules) {
      parts.push(`${r.value} ${stockWord} ${dateWord}`);
    }
    parts.push(`all other languages ${stockWord} ${dateWord}`);
    parts.push(`then ${otherStockWord} by ${newestFirst ? "newest" : "oldest"}`);
  } else {
    parts.push(`${stockWord} ${dateWord} first`);
    parts.push(`then ${otherStockWord} by ${newestFirst ? "newest" : "oldest"}`);
  }

  return parts
    .map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join(", then ") + ".";
}

// ── Main page component ───────────────────────────────────────────────────────

export default function CollectionSortManager() {
  const { stores, selectedStoreId, selectedStore, setSelectedStoreId } = useStore();
  const queryClient = useQueryClient();

  // Collection state
  const [allCollections, setAllCollections] = useState<ShopifyCollection[]>([]);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [includeSearch, setIncludeSearch] = useState("");
  const [excludeSearch, setExcludeSearch] = useState("");
  const [loadingCollections, setLoadingCollections] = useState(false);

  // Language state
  const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
  const [loadingLanguages, setLoadingLanguages] = useState(false);

  // Sort rules
  const [sortRules, setSortRules] = useState<SortRule[]>([
    { id: "lang-1", type: "language", value: "English", priority: 1 },
    { id: "stock-1", type: "stock", value: "in_stock_first" },
    { id: "date-1", type: "date", value: "newest_first" },
  ]);

  // Drag state for language rules
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // UI state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [collectionProgress, setCollectionProgress] = useState<CollectionProgress[]>([]);
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);

  // ── Last run query ──────────────────────────────────────────────────────────
  const { data: lastRun } = useQuery({
    queryKey: ["collection-sort-last-run", selectedStoreId],
    queryFn: async () => {
      if (!selectedStoreId) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("collection_sort_runs")
        .select("*")
        .eq("store_id", selectedStoreId)
        .order("run_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as {
        id: string;
        run_at: string;
        collections_sorted: number;
        products_reordered: number;
        errors: Array<{ collectionId: string; title: string; error: string }>;
      } | null;
    },
    enabled: !!selectedStoreId,
  });

  // ── Fetch collections when store changes ────────────────────────────────────
  const fetchCollections = useCallback(async (storeId: string) => {
    setLoadingCollections(true);
    setAllCollections([]);
    setExcludedIds(new Set());
    setCheckedIds(new Set());
    try {
      const { data, error } = await supabase.functions.invoke("collection-sort-manager", {
        body: { action: "get_collections", storeId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Failed to fetch collections");

      const cols: ShopifyCollection[] = data.collections ?? [];
      setAllCollections(cols);

      const autoExclude = new Set<string>();
      const allChecked = new Set<string>();
      for (const c of cols) {
        if (shouldAutoExclude(c.handle)) {
          autoExclude.add(c.id);
        } else {
          allChecked.add(c.id);
        }
      }
      setExcludedIds(autoExclude);
      setCheckedIds(allChecked);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to load collections: ${msg}`);
    } finally {
      setLoadingCollections(false);
    }
  }, []);

  // ── Fetch languages when store changes ──────────────────────────────────────
  const fetchLanguages = useCallback(async (storeId: string) => {
    setLoadingLanguages(true);
    try {
      const { data, error } = await supabase.functions.invoke("collection-sort-manager", {
        body: { action: "get_languages", storeId },
      });
      if (error) throw error;
      const fetched: string[] = data?.languages ?? [];
      // Merge with canonical list, deduplicate
      const merged = Array.from(new Set([...CANONICAL_LANGUAGES, ...fetched])).sort();
      setAvailableLanguages(merged);
    } catch {
      setAvailableLanguages(CANONICAL_LANGUAGES);
    } finally {
      setLoadingLanguages(false);
    }
  }, []);

  useEffect(() => {
    if (selectedStoreId) {
      fetchCollections(selectedStoreId);
      fetchLanguages(selectedStoreId);
    }
  }, [selectedStoreId, fetchCollections, fetchLanguages]);

  // ── Derived collection lists ────────────────────────────────────────────────
  const includedCollections = useMemo(
    () => allCollections.filter((c) => !excludedIds.has(c.id)),
    [allCollections, excludedIds],
  );

  const excludedCollections = useMemo(
    () => allCollections.filter((c) => excludedIds.has(c.id)),
    [allCollections, excludedIds],
  );

  const filteredIncluded = useMemo(
    () =>
      includedCollections.filter(
        (c) => !includeSearch || c.title.toLowerCase().includes(includeSearch.toLowerCase()),
      ),
    [includedCollections, includeSearch],
  );

  const filteredExcluded = useMemo(
    () =>
      excludedCollections.filter(
        (c) => !excludeSearch || c.title.toLowerCase().includes(excludeSearch.toLowerCase()),
      ),
    [excludedCollections, excludeSearch],
  );

  const sortableCollections = useMemo(
    () => includedCollections.filter((c) => checkedIds.has(c.id)),
    [includedCollections, checkedIds],
  );

  // ── Collection list actions ─────────────────────────────────────────────────
  function moveToExclude(id: string) {
    setExcludedIds((prev) => new Set([...prev, id]));
    setCheckedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }

  function moveToInclude(id: string) {
    setExcludedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setCheckedIds((prev) => new Set([...prev, id]));
  }

  function selectAllIncluded() {
    const ids = filteredIncluded.map((c) => c.id);
    setCheckedIds((prev) => new Set([...prev, ...ids]));
  }

  function deselectAllIncluded() {
    const ids = new Set(filteredIncluded.map((c) => c.id));
    setCheckedIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n; });
  }

  function toggleChecked(id: string) {
    setCheckedIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  // ── Sort rule actions ───────────────────────────────────────────────────────
  const languageRules = useMemo(
    () => sortRules.filter((r) => r.type === "language").sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)),
    [sortRules],
  );

  function addLanguageRule() {
    const nextPriority = languageRules.length + 1;
    setSortRules((prev) => [
      ...prev.filter((r) => r.type !== "language"),
      ...languageRules,
      { id: `lang-${Date.now()}`, type: "language", value: CANONICAL_LANGUAGES[0], priority: nextPriority },
    ]);
  }

  function removeLanguageRule(id: string) {
    setSortRules((prev) => {
      const remaining = prev.filter((r) => r.id !== id);
      const langs = remaining
        .filter((r) => r.type === "language")
        .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
        .map((r, i) => ({ ...r, priority: i + 1 }));
      const others = remaining.filter((r) => r.type !== "language");
      return [...langs, ...others];
    });
  }

  function updateLanguageValue(id: string, value: string) {
    setSortRules((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));
  }

  function setStockRule(value: string) {
    setSortRules((prev) =>
      prev.map((r) => (r.type === "stock" ? { ...r, value } : r)),
    );
  }

  function setDateRule(value: string) {
    setSortRules((prev) =>
      prev.map((r) => (r.type === "date" ? { ...r, value } : r)),
    );
  }

  const stockRule = sortRules.find((r) => r.type === "stock");
  const dateRule = sortRules.find((r) => r.type === "date");

  // ── Drag and drop for language rules ────────────────────────────────────────
  function handleDragStart(e: React.DragEvent, index: number) {
    e.dataTransfer.setData("text/plain", String(index));
    setDragIndex(index);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    setDragOverIndex(index);
  }

  function handleDrop(e: React.DragEvent, toIndex: number) {
    e.preventDefault();
    const fromIndex = Number(e.dataTransfer.getData("text/plain"));
    if (fromIndex === toIndex) { setDragIndex(null); setDragOverIndex(null); return; }

    setSortRules((prev) => {
      const langs = prev
        .filter((r) => r.type === "language")
        .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
      const others = prev.filter((r) => r.type !== "language");
      const newLangs = [...langs];
      const [moved] = newLangs.splice(fromIndex, 1);
      newLangs.splice(toIndex, 0, moved);
      return [...newLangs.map((r, i) => ({ ...r, priority: i + 1 })), ...others];
    });
    setDragIndex(null);
    setDragOverIndex(null);
  }

  function handleDragEnd() {
    setDragIndex(null);
    setDragOverIndex(null);
  }

  // ── Run sort ─────────────────────────────────────────────────────────────────
  function openConfirmModal() {
    if (sortableCollections.length === 0) {
      toast.error("No collections selected to sort.");
      return;
    }
    setConfirmOpen(true);
  }

  async function confirmAndRun() {
    setConfirmOpen(false);
    setRunning(true);
    setRunSummary(null);

    const initialProgress: CollectionProgress[] = sortableCollections.map((c) => ({
      id: c.id,
      title: c.title,
      status: "pending",
    }));
    setCollectionProgress(initialProgress);

    // Mark first as processing
    setCollectionProgress((prev) =>
      prev.map((p, i) => (i === 0 ? { ...p, status: "processing" } : p)),
    );

    const rulesPayload = [
      ...languageRules.map((r) => ({ type: "language" as const, value: r.value, priority: r.priority })),
      ...(stockRule ? [{ type: "stock" as const, value: stockRule.value }] : []),
      ...(dateRule ? [{ type: "date" as const, value: dateRule.value }] : []),
    ];

    try {
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/collection-sort-manager`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "run_sort",
            storeId: selectedStoreId,
            collections: sortableCollections.map((c) => c.id),
            sortRules: rulesPayload,
          }),
        },
      );

      if (!response.ok || !response.body) {
        throw new Error(`Edge function returned ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let processedCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);

            if (data.type === "summary") {
              const summary: RunSummary = {
                collectionsTotal: data.collectionsTotal,
                collectionsSorted: data.collectionsSorted,
                totalProductsReordered: data.totalProductsReordered,
                errors: data.errors ?? [],
                runAt: data.runAt,
              };
              setRunSummary(summary);
              queryClient.invalidateQueries({ queryKey: ["collection-sort-last-run"] });
              continue;
            }

            // Per-collection progress line
            processedCount++;
            const nextIndex = processedCount; // 0-indexed next collection to process

            setCollectionProgress((prev) =>
              prev.map((p, idx) => {
                if (p.id === data.collectionId) {
                  return {
                    ...p,
                    status: data.status,
                    productsReordered: data.productsReordered,
                    error: data.error,
                  };
                }
                if (idx === nextIndex && p.status === "pending") {
                  return { ...p, status: "processing" };
                }
                return p;
              }),
            );
          } catch {
            // Ignore malformed lines
          }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Sort run failed: ${msg}`);
    } finally {
      setRunning(false);
    }
  }

  // ── Progress derived values ───────────────────────────────────────────────
  const doneCount = collectionProgress.filter(
    (p) => p.status === "done" || p.status === "failed",
  ).length;
  const progressPercent =
    collectionProgress.length > 0
      ? Math.round((doneCount / collectionProgress.length) * 100)
      : 0;

  const currentlyProcessing = collectionProgress.find((p) => p.status === "processing");

  // ── Sort summary text ─────────────────────────────────────────────────────
  const sortSummaryText = useMemo(() => buildSortSummary(sortRules), [sortRules]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ListOrdered className="h-6 w-6" /> Collection Sort Manager
          </h1>
          <p className="text-sm text-muted-foreground">
            Sort Shopify collection products by language, stock status, and arrival date
          </p>
        </div>
        {lastRun && (
          <div className="text-right text-xs text-muted-foreground">
            <p className="font-medium">Last run</p>
            <p>{new Date(lastRun.run_at).toLocaleString()}</p>
            <p>
              {lastRun.collections_sorted} collections · {lastRun.products_reordered} products
            </p>
          </div>
        )}
      </div>

      {/* ── Section A: Store & Collection Scope ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Store &amp; Collection Scope</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Store selector */}
          <div className="flex items-center gap-3">
            <Label className="shrink-0">Store</Label>
            <Select
              value={selectedStoreId ?? ""}
              onValueChange={(v) => setSelectedStoreId(v)}
            >
              <SelectTrigger className="w-[260px]">
                <SelectValue placeholder="Select a store" />
              </SelectTrigger>
              <SelectContent>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.store_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {loadingCollections && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading collections…
              </span>
            )}
          </div>

          {/* Two-panel collection lists */}
          <div className="grid grid-cols-2 gap-4">
            {/* Include list */}
            <div className="border rounded-md flex flex-col">
              <div className="p-3 border-b bg-muted/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    Include Collections
                    <Badge variant="secondary" className="ml-2">{includedCollections.length}</Badge>
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs px-2"
                      onClick={selectAllIncluded}
                    >
                      <CheckSquare className="h-3 w-3 mr-1" /> All
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs px-2"
                      onClick={deselectAllIncluded}
                    >
                      <Square className="h-3 w-3 mr-1" /> None
                    </Button>
                  </div>
                </div>
                <Input
                  placeholder="Search collections…"
                  value={includeSearch}
                  onChange={(e) => setIncludeSearch(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
              <ScrollArea className="h-56">
                <div className="p-1">
                  {filteredIncluded.length === 0 && (
                    <p className="text-xs text-muted-foreground p-3 text-center">
                      {loadingCollections ? "Loading…" : "No collections"}
                    </p>
                  )}
                  {filteredIncluded.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 group"
                    >
                      <Checkbox
                        checked={checkedIds.has(c.id)}
                        onCheckedChange={() => toggleChecked(c.id)}
                      />
                      <span className="text-xs flex-1 truncate" title={c.title}>{c.title}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                        title="Move to Exclude"
                        onClick={() => moveToExclude(c.id)}
                      >
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="p-2 border-t bg-muted/20 text-xs text-muted-foreground">
                {sortableCollections.length} selected for sort
              </div>
            </div>

            {/* Exclude list */}
            <div className="border rounded-md flex flex-col">
              <div className="p-3 border-b bg-muted/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    Exclude Collections
                    <Badge variant="outline" className="ml-2">{excludedCollections.length}</Badge>
                  </span>
                </div>
                <Input
                  placeholder="Search excluded…"
                  value={excludeSearch}
                  onChange={(e) => setExcludeSearch(e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
              <ScrollArea className="h-56">
                <div className="p-1">
                  {filteredExcluded.length === 0 && (
                    <p className="text-xs text-muted-foreground p-3 text-center">
                      No excluded collections
                    </p>
                  )}
                  {filteredExcluded.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 group"
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary"
                        title="Move back to Include"
                        onClick={() => moveToInclude(c.id)}
                      >
                        <ChevronLeft className="h-3 w-3" />
                      </Button>
                      <span className="text-xs flex-1 truncate line-through text-muted-foreground" title={c.title}>
                        {c.title}
                      </span>
                      <X
                        className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 cursor-pointer hover:text-destructive"
                        onClick={() => moveToInclude(c.id)}
                      />
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="p-2 border-t bg-muted/20 text-xs text-muted-foreground">
                These will be skipped
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Section B: Sort Priority Builder ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sort Priority Builder</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Language rules */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium">Language Priority</Label>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={addLanguageRule}
                disabled={loadingLanguages}
              >
                <Plus className="h-3 w-3 mr-1" /> Add Language
              </Button>
            </div>

            <div className="space-y-2">
              {languageRules.map((rule, index) => (
                <div
                  key={rule.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-2 p-2 rounded border bg-card transition-colors cursor-move ${
                    dragOverIndex === index && dragIndex !== index
                      ? "border-primary bg-primary/5"
                      : "border-border"
                  }`}
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Badge variant="secondary" className="w-5 h-5 p-0 flex items-center justify-center text-xs shrink-0">
                    {rule.priority}
                  </Badge>
                  <Select
                    value={rule.value}
                    onValueChange={(v) => updateLanguageValue(rule.id, v)}
                  >
                    <SelectTrigger className="h-7 flex-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(availableLanguages.length > 0 ? availableLanguages : CANONICAL_LANGUAGES).map((lang) => (
                        <SelectItem key={lang} value={lang} className="text-xs">{lang}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeLanguageRule(rule.id)}
                    disabled={languageRules.length <= 1}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Stock rule */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Stock Status</Label>
              <p className="text-xs text-muted-foreground">Sort in-stock products first or last</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs ${stockRule?.value === "out_of_stock_first" ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                OOS First
              </span>
              <Switch
                checked={!stockRule || stockRule.value === "in_stock_first"}
                onCheckedChange={(v) => setStockRule(v ? "in_stock_first" : "out_of_stock_first")}
              />
              <span className={`text-xs ${!stockRule || stockRule.value === "in_stock_first" ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                In-Stock First
              </span>
            </div>
          </div>

          {/* Date rule */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Arrival Date</Label>
              <p className="text-xs text-muted-foreground">Sort by published date within each group</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs ${dateRule?.value === "oldest_first" ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                Oldest First
              </span>
              <Switch
                checked={!dateRule || dateRule.value === "newest_first"}
                onCheckedChange={(v) => setDateRule(v ? "newest_first" : "oldest_first")}
              />
              <span className={`text-xs ${!dateRule || dateRule.value === "newest_first" ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                Newest First
              </span>
            </div>
          </div>

          {/* Live plain-English summary */}
          <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <ArrowUpDown className="h-3 w-3" /> Sort order preview
            </p>
            <p className="text-sm leading-relaxed">{sortSummaryText}</p>
          </div>
        </CardContent>
      </Card>

      {/* ── Run Sort Button ── */}
      <div className="flex justify-end">
        <Button
          size="lg"
          className="px-10 text-base font-semibold"
          onClick={openConfirmModal}
          disabled={running || sortableCollections.length === 0 || loadingCollections}
        >
          {running ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sorting…</>
          ) : (
            <><ArrowUpDown className="h-4 w-4 mr-2" /> Run Sort</>
          )}
        </Button>
      </div>

      {/* ── Progress section (shown during and after run) ── */}
      {collectionProgress.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Sort Progress</span>
              <Badge variant={running ? "secondary" : runSummary ? "default" : "outline"}>
                {running ? "Running" : runSummary ? "Complete" : "Idle"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Overall progress bar */}
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{doneCount} / {collectionProgress.length} collections</span>
                <span>{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
            </div>

            {/* Currently processing */}
            {currentlyProcessing && (
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                <span>Processing: <strong>{currentlyProcessing.title}</strong></span>
              </div>
            )}

            {/* Per-collection status table */}
            <ScrollArea className="h-64">
              <div className="space-y-1">
                {collectionProgress.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 px-2 py-1.5 rounded text-sm"
                  >
                    <span className="shrink-0">
                      {item.status === "pending" && (
                        <span className="h-2 w-2 rounded-full bg-muted-foreground/30 inline-block" />
                      )}
                      {item.status === "processing" && (
                        <Loader2 className="h-3 w-3 animate-spin text-primary" />
                      )}
                      {item.status === "done" && (
                        <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
                      )}
                      {item.status === "failed" && (
                        <span className="h-2 w-2 rounded-full bg-destructive inline-block" />
                      )}
                    </span>
                    <span className="flex-1 truncate">{item.title}</span>
                    {item.status === "done" && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {item.productsReordered} products
                      </span>
                    )}
                    {item.status === "failed" && (
                      <span className="text-xs text-destructive shrink-0 max-w-[180px] truncate" title={item.error}>
                        {item.error}
                      </span>
                    )}
                    <Badge
                      variant={
                        item.status === "done"
                          ? "default"
                          : item.status === "failed"
                          ? "destructive"
                          : item.status === "processing"
                          ? "secondary"
                          : "outline"
                      }
                      className="text-xs h-5 shrink-0"
                    >
                      {item.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* ── Run Summary (after completion) ── */}
      {runSummary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Run Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-muted rounded-md p-3 text-center">
                <p className="text-2xl font-bold">{runSummary.collectionsSorted}</p>
                <p className="text-xs text-muted-foreground">Collections sorted</p>
              </div>
              <div className="bg-muted rounded-md p-3 text-center">
                <p className="text-2xl font-bold">{runSummary.totalProductsReordered}</p>
                <p className="text-xs text-muted-foreground">Products reordered</p>
              </div>
              <div className="bg-muted rounded-md p-3 text-center">
                <p className={`text-2xl font-bold ${runSummary.errors.length > 0 ? "text-destructive" : "text-emerald-500"}`}>
                  {runSummary.errors.length}
                </p>
                <p className="text-xs text-muted-foreground">Errors</p>
              </div>
            </div>

            {runSummary.errors.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">Failed collections:</p>
                {runSummary.errors.map((err, i) => (
                  <div key={i} className="text-xs bg-destructive/10 rounded p-2">
                    <span className="font-medium">{err.title}</span>
                    <span className="text-muted-foreground ml-2">{err.error}</span>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Completed at {new Date(runSummary.runAt).toLocaleString()}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Confirmation Modal ── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm Sort Run</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            {/* Store */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Store</p>
              <p className="font-medium">{selectedStore?.store_name ?? "Unknown"}</p>
            </div>

            {/* Collections to sort */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Collections to sort ({sortableCollections.length})
              </p>
              <ScrollArea className="h-32 border rounded-md">
                <div className="p-2 space-y-0.5">
                  {sortableCollections.map((c) => (
                    <p key={c.id} className="text-xs py-0.5">{c.title}</p>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Collections to skip */}
            {excludedCollections.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Collections skipped ({excludedCollections.length + (includedCollections.length - sortableCollections.length)})
                </p>
                <ScrollArea className="h-20 border rounded-md">
                  <div className="p-2 space-y-0.5">
                    {excludedCollections.map((c) => (
                      <p key={c.id} className="text-xs py-0.5 text-muted-foreground line-through">{c.title}</p>
                    ))}
                    {includedCollections
                      .filter((c) => !checkedIds.has(c.id))
                      .map((c) => (
                        <p key={c.id} className="text-xs py-0.5 text-muted-foreground">{c.title}</p>
                      ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Sort logic */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Sort Logic</p>
              <p className="text-xs bg-muted rounded p-2 leading-relaxed">{sortSummaryText}</p>
            </div>

            {/* Warning */}
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                This will permanently reorder products in the selected collections. This cannot be automatically undone.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmAndRun}>
              Confirm &amp; Run Sort
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
