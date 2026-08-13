import { useState, useEffect, useCallback, useMemo } from "react";
import { useRole } from "@/hooks/useRole";
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
  AlertTriangle, ChevronRight, ChevronLeft, Loader2, ListOrdered, RefreshCw, History,
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

// ── Sort run log helpers ──────────────────────────────────────────────────────

interface SortRunLog {
  id: string;
  run_at: string;
  collections_sorted: number;
  products_reordered: number;
  sort_rules: Array<Record<string, unknown>>;
  errors: Array<{ collectionId: string; title: string; error: string }>;
}

function formatRelativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(isoStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const SP_RULE_LABELS: Record<string, string> = {
  best_selling_first: "Best Selling",
  units_sold_first: "Most Units",
  revenue_first: "Revenue",
};
const DC_RULE_LABELS: Record<string, string> = {
  discounted_first: "Discounted First",
  highest_discount_first: "Highest Discount",
};
const IV_RULE_LABELS: Record<string, string> = {
  low_stock_first: "Low Stock First",
  overstock_first: "Overstock First",
};
const SP_TYPES = new Set(Object.keys(SP_RULE_LABELS));
const DC_TYPES = new Set(Object.keys(DC_RULE_LABELS));
const IV_TYPES = new Set(Object.keys(IV_RULE_LABELS));

function formatSalesConfig(rules: Array<Record<string, unknown>>): string {
  const m = rules[0] ?? {};
  return [
    SP_RULE_LABELS[m.type as string] ?? (m.type as string ?? "—"),
    `${m.salesWindowDays ?? 30}d`,
    m.inStockFirst !== false ? "In-Stock First" : "OOS First",
  ].join(" · ");
}
function formatDiscountConfig(rules: Array<Record<string, unknown>>): string {
  const m = rules[0] ?? {};
  return [
    DC_RULE_LABELS[m.type as string] ?? (m.type as string ?? "—"),
    m.inStockFirst !== false ? "In-Stock First" : "OOS First",
  ].join(" · ");
}
function formatInventoryConfig(rules: Array<Record<string, unknown>>): string {
  const m = rules[0] ?? {};
  const parts = [IV_RULE_LABELS[m.type as string] ?? (m.type as string ?? "—")];
  if (m.lowStockThreshold != null) parts.push(`Low≤${m.lowStockThreshold}`);
  if (m.overstockThreshold != null) parts.push(`High≥${m.overstockThreshold}`);
  parts.push(m.inStockFirst !== false ? "In-Stock First" : "OOS First");
  return parts.join(" · ");
}
function formatPriorityConfig(rules: Array<Record<string, unknown>>): string {
  return rules
    .map((r) => {
      if (r.type === "language") return `Lang: ${r.value}`;
      if (r.type === "stock") return String(r.value).replace(/_/g, " ");
      if (r.type === "date") return String(r.value).replace(/_/g, " ");
      return String(r.type ?? "");
    })
    .join(" → ") || "—";
}

function SortHistorySection({
  runs,
  formatConfig,
}: {
  runs: SortRunLog[];
  formatConfig: (rules: Array<Record<string, unknown>>) => string;
}) {
  if (runs.length === 0) return null;
  return (
    <div className="border-t pt-3 mt-1">
      <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
        <History className="h-3 w-3" /> Sort History
      </p>
      <div>
        {runs.slice(0, 5).map((run) => (
          <div key={run.id} className="flex items-center justify-between text-xs py-1.5 border-b border-dashed last:border-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-muted-foreground shrink-0 w-[72px]">{formatRelativeTime(run.run_at)}</span>
              <span className="truncate">{formatConfig(run.sort_rules ?? [])}</span>
            </div>
            <div className="text-muted-foreground flex items-center gap-1 shrink-0 ml-3">
              <span>{run.collections_sorted}c · {run.products_reordered.toLocaleString()}p</span>
              {(run.errors?.length ?? 0) > 0 && (
                <Badge variant="destructive" className="text-[10px] h-4 px-1 py-0 ml-1">{run.errors.length} err</Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── NDJSON streaming helper (shared by all 4 sort runners) ────────────────────
// Guards against a stalled/killed edge-function connection: without this, a
// dropped stream just leaves reader.read() pending forever and the UI shows
// "processing" indefinitely with no error.
const STREAM_IDLE_TIMEOUT_MS = 45_000;

async function readNdjsonStream(
  response: Response,
  onLine: (data: Record<string, unknown>) => void,
): Promise<void> {
  if (!response.body) throw new Error("Response has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const idleTimeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Stream stalled — no data received for ${STREAM_IDLE_TIMEOUT_MS / 1000}s`)),
          STREAM_IDLE_TIMEOUT_MS,
        );
      });
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await Promise.race([reader.read(), idleTimeout]);
      } finally {
        clearTimeout(timer);
      }
      if (result.done) break;

      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.type === "heartbeat") continue; // keep-alive only, no progress to apply
          onLine(data);
        } catch {
          // Ignore malformed lines
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

// If a run throws (including a stream stall), whatever collection was still
// "processing" would otherwise be stuck in that state forever in the UI.
function failStalledProgress(
  setProgress: (updater: (prev: CollectionProgress[]) => CollectionProgress[]) => void,
  message: string,
) {
  setProgress((prev) =>
    prev.map((p) => (p.status === "processing" ? { ...p, status: "failed", error: message } : p)),
  );
}

// ── Main page component ───────────────────────────────────────────────────────

export default function CollectionSortManager() {
  const { canEdit } = useRole();
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

  // ── Module 1: Sales & Performance ──────────────────────────────────────────
  const [spExcludedIds, setSpExcludedIds] = useState<Set<string>>(new Set());
  const [spCheckedIds, setSpCheckedIds] = useState<Set<string>>(new Set());
  const [spIncludeSearch, setSpIncludeSearch] = useState("");
  const [spExcludeSearch, setSpExcludeSearch] = useState("");
  const [spSortRule, setSpSortRule] = useState<"best_selling_first" | "revenue_first" | "units_sold_first">("best_selling_first");
  const [spSalesWindow, setSpSalesWindow] = useState<30 | 60 | 90>(30);
  const [spConfirmOpen, setSpConfirmOpen] = useState(false);
  const [spRunning, setSpRunning] = useState(false);
  const [spCollectionProgress, setSpCollectionProgress] = useState<CollectionProgress[]>([]);
  const [spRunSummary, setSpRunSummary] = useState<RunSummary | null>(null);

  // ── Module 2: Discount & Campaign ──────────────────────────────────────────
  const [dcExcludedIds, setDcExcludedIds] = useState<Set<string>>(new Set());
  const [dcCheckedIds, setDcCheckedIds] = useState<Set<string>>(new Set());
  const [dcIncludeSearch, setDcIncludeSearch] = useState("");
  const [dcExcludeSearch, setDcExcludeSearch] = useState("");
  const [dcSortRule, setDcSortRule] = useState<"discounted_first" | "highest_discount_first">("discounted_first");
  const [dcConfirmOpen, setDcConfirmOpen] = useState(false);
  const [dcRunning, setDcRunning] = useState(false);
  const [dcCollectionProgress, setDcCollectionProgress] = useState<CollectionProgress[]>([]);
  const [dcRunSummary, setDcRunSummary] = useState<RunSummary | null>(null);

  // ── In-stock-first toggles (one per module, default on) ────────────────────
  const [spInStockFirst, setSpInStockFirst] = useState(true);
  const [dcInStockFirst, setDcInStockFirst] = useState(true);
  const [invInStockFirst, setInvInStockFirst] = useState(true);

  // ── Module 3: Inventory ─────────────────────────────────────────────────────
  const [invExcludedIds, setInvExcludedIds] = useState<Set<string>>(new Set());
  const [invCheckedIds, setInvCheckedIds] = useState<Set<string>>(new Set());
  const [invIncludeSearch, setInvIncludeSearch] = useState("");
  const [invExcludeSearch, setInvExcludeSearch] = useState("");
  const [invSortRule, setInvSortRule] = useState<"low_stock_first" | "overstock_first">("low_stock_first");
  const [lowStockThreshold, setLowStockThreshold] = useState(5);
  const [overstockThreshold, setOverstockThreshold] = useState(50);
  const [invConfirmOpen, setInvConfirmOpen] = useState(false);
  const [invRunning, setInvRunning] = useState(false);
  const [invCollectionProgress, setInvCollectionProgress] = useState<CollectionProgress[]>([]);
  const [invRunSummary, setInvRunSummary] = useState<RunSummary | null>(null);

  // ── Setup: create collections/all ──────────────────────────────────────────
  const [settingUpAll, setSettingUpAll] = useState(false);

  const hasAllCollection = allCollections.some((c) => c.handle === "all");

  async function setupAllCollection() {
    if (!selectedStoreId) return;
    setSettingUpAll(true);
    try {
      const { data, error } = await supabase.functions.invoke("collection-sort-manager", {
        body: { action: "create_all_collection", storeId: selectedStoreId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Failed to create collection");
      toast.success("All Products collection created! Reloading collections…");
      await fetchCollections(selectedStoreId);
    } catch (e: unknown) {
      toast.error(`Setup failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSettingUpAll(false);
    }
  }

  // ── Sort run log query ───────────────────────────────────────────────────────
  const { data: allSortRuns } = useQuery({
    queryKey: ["collection-sort-all-runs", selectedStoreId],
    queryFn: async () => {
      if (!selectedStoreId) return [] as SortRunLog[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("collection_sort_runs")
        .select("id, run_at, collections_sorted, products_reordered, sort_rules, errors")
        .eq("store_id", selectedStoreId)
        .order("run_at", { ascending: false })
        .limit(20);
      return (data ?? []) as SortRunLog[];
    },
    enabled: !!selectedStoreId,
  });

  const lastRun = allSortRuns?.[0] ?? null;
  const spRunLog = allSortRuns?.filter((r) => SP_TYPES.has(r.sort_rules?.[0]?.type as string)) ?? [];
  const dcRunLog = allSortRuns?.filter((r) => DC_TYPES.has(r.sort_rules?.[0]?.type as string)) ?? [];
  const ivRunLog = allSortRuns?.filter((r) => IV_TYPES.has(r.sort_rules?.[0]?.type as string)) ?? [];
  const prRunLog = allSortRuns?.filter((r) => {
    const t = r.sort_rules?.[0]?.type as string;
    return !SP_TYPES.has(t) && !DC_TYPES.has(t) && !IV_TYPES.has(t);
  }) ?? [];

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

  // Sync per-module collection selectors whenever allCollections changes
  useEffect(() => {
    if (allCollections.length === 0) return;
    const autoExclude = new Set<string>();
    const allChecked = new Set<string>();
    for (const c of allCollections) {
      if (shouldAutoExclude(c.handle)) {
        autoExclude.add(c.id);
      } else {
        allChecked.add(c.id);
      }
    }
    setSpExcludedIds(new Set(autoExclude));
    setSpCheckedIds(new Set(allChecked));
    setDcExcludedIds(new Set(autoExclude));
    setDcCheckedIds(new Set(allChecked));
    setInvExcludedIds(new Set(autoExclude));
    setInvCheckedIds(new Set(allChecked));
  }, [allCollections]);

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

  // ── Module 1 derived ────────────────────────────────────────────────────────
  const spIncludedCollections = useMemo(
    () => allCollections.filter((c) => !spExcludedIds.has(c.id)),
    [allCollections, spExcludedIds],
  );
  const spExcludedCollections = useMemo(
    () => allCollections.filter((c) => spExcludedIds.has(c.id)),
    [allCollections, spExcludedIds],
  );
  const spFilteredIncluded = useMemo(
    () => spIncludedCollections.filter(
      (c) => !spIncludeSearch || c.title.toLowerCase().includes(spIncludeSearch.toLowerCase()),
    ),
    [spIncludedCollections, spIncludeSearch],
  );
  const spFilteredExcluded = useMemo(
    () => spExcludedCollections.filter(
      (c) => !spExcludeSearch || c.title.toLowerCase().includes(spExcludeSearch.toLowerCase()),
    ),
    [spExcludedCollections, spExcludeSearch],
  );
  const spSortableCollections = useMemo(
    () => spIncludedCollections.filter((c) => spCheckedIds.has(c.id)),
    [spIncludedCollections, spCheckedIds],
  );

  // ── Module 2 derived ────────────────────────────────────────────────────────
  const dcIncludedCollections = useMemo(
    () => allCollections.filter((c) => !dcExcludedIds.has(c.id)),
    [allCollections, dcExcludedIds],
  );
  const dcExcludedCollections = useMemo(
    () => allCollections.filter((c) => dcExcludedIds.has(c.id)),
    [allCollections, dcExcludedIds],
  );
  const dcFilteredIncluded = useMemo(
    () => dcIncludedCollections.filter(
      (c) => !dcIncludeSearch || c.title.toLowerCase().includes(dcIncludeSearch.toLowerCase()),
    ),
    [dcIncludedCollections, dcIncludeSearch],
  );
  const dcFilteredExcluded = useMemo(
    () => dcExcludedCollections.filter(
      (c) => !dcExcludeSearch || c.title.toLowerCase().includes(dcExcludeSearch.toLowerCase()),
    ),
    [dcExcludedCollections, dcExcludeSearch],
  );
  const dcSortableCollections = useMemo(
    () => dcIncludedCollections.filter((c) => dcCheckedIds.has(c.id)),
    [dcIncludedCollections, dcCheckedIds],
  );

  // ── Module 3 derived ────────────────────────────────────────────────────────
  const invIncludedCollections = useMemo(
    () => allCollections.filter((c) => !invExcludedIds.has(c.id)),
    [allCollections, invExcludedIds],
  );
  const invExcludedCollections = useMemo(
    () => allCollections.filter((c) => invExcludedIds.has(c.id)),
    [allCollections, invExcludedIds],
  );
  const invFilteredIncluded = useMemo(
    () => invIncludedCollections.filter(
      (c) => !invIncludeSearch || c.title.toLowerCase().includes(invIncludeSearch.toLowerCase()),
    ),
    [invIncludedCollections, invIncludeSearch],
  );
  const invFilteredExcluded = useMemo(
    () => invExcludedCollections.filter(
      (c) => !invExcludeSearch || c.title.toLowerCase().includes(invExcludeSearch.toLowerCase()),
    ),
    [invExcludedCollections, invExcludeSearch],
  );
  const invSortableCollections = useMemo(
    () => invIncludedCollections.filter((c) => invCheckedIds.has(c.id)),
    [invIncludedCollections, invCheckedIds],
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

  // ── Module 1 collection actions ─────────────────────────────────────────────
  function spMoveToExclude(id: string) {
    setSpExcludedIds((prev) => new Set([...prev, id]));
    setSpCheckedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }
  function spMoveToInclude(id: string) {
    setSpExcludedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setSpCheckedIds((prev) => new Set([...prev, id]));
  }
  function spSelectAll() {
    setSpCheckedIds((prev) => new Set([...prev, ...spFilteredIncluded.map((c) => c.id)]));
  }
  function spDeselectAll() {
    const ids = new Set(spFilteredIncluded.map((c) => c.id));
    setSpCheckedIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n; });
  }
  function spToggleChecked(id: string) {
    setSpCheckedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // ── Module 2 collection actions ─────────────────────────────────────────────
  function dcMoveToExclude(id: string) {
    setDcExcludedIds((prev) => new Set([...prev, id]));
    setDcCheckedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }
  function dcMoveToInclude(id: string) {
    setDcExcludedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setDcCheckedIds((prev) => new Set([...prev, id]));
  }
  function dcSelectAll() {
    setDcCheckedIds((prev) => new Set([...prev, ...dcFilteredIncluded.map((c) => c.id)]));
  }
  function dcDeselectAll() {
    const ids = new Set(dcFilteredIncluded.map((c) => c.id));
    setDcCheckedIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n; });
  }
  function dcToggleChecked(id: string) {
    setDcCheckedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // ── Module 3 collection actions ─────────────────────────────────────────────
  function invMoveToExclude(id: string) {
    setInvExcludedIds((prev) => new Set([...prev, id]));
    setInvCheckedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }
  function invMoveToInclude(id: string) {
    setInvExcludedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setInvCheckedIds((prev) => new Set([...prev, id]));
  }
  function invSelectAll() {
    setInvCheckedIds((prev) => new Set([...prev, ...invFilteredIncluded.map((c) => c.id)]));
  }
  function invDeselectAll() {
    const ids = new Set(invFilteredIncluded.map((c) => c.id));
    setInvCheckedIds((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n; });
  }
  function invToggleChecked(id: string) {
    setInvCheckedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
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

      let processedCount = 0;
      let summaryReceived = false;
      await readNdjsonStream(response, (data) => {
        if (data.type === "summary") {
          summaryReceived = true;
          const summary: RunSummary = {
            collectionsTotal: data.collectionsTotal as number,
            collectionsSorted: data.collectionsSorted as number,
            totalProductsReordered: data.totalProductsReordered as number,
            errors: (data.errors as RunSummary["errors"]) ?? [],
            runAt: data.runAt as string,
          };
          setRunSummary(summary);
          queryClient.invalidateQueries({ queryKey: ["collection-sort-all-runs"] });
          return;
        }

        // Per-collection progress line
        processedCount++;
        const nextIndex = processedCount; // 0-indexed next collection to process

        setCollectionProgress((prev) =>
          prev.map((p, idx) => {
            if (p.id === data.collectionId) {
              return {
                ...p,
                status: data.status as CollectionProgress["status"],
                productsReordered: data.productsReordered as number | undefined,
                error: data.error as string | undefined,
              };
            }
            if (idx === nextIndex && p.status === "pending") {
              return { ...p, status: "processing" };
            }
            return p;
          }),
        );
      });
      // The connection can close cleanly (no throw) before the backend ever
      // reaches its "summary" frame — e.g. the platform kills a long-running
      // invocation mid-run. That leaves whatever was "processing" stuck
      // forever with no error, since the catch block below never runs.
      if (!summaryReceived) {
        const msg = "Connection closed before the run finished";
        toast.error(`Sort run failed: ${msg}`);
        failStalledProgress(setCollectionProgress, msg);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Sort run failed: ${msg}`);
      failStalledProgress(setCollectionProgress, msg);
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

  // ── Module 1 run ─────────────────────────────────────────────────────────────
  function openSpConfirmModal() {
    if (spSortableCollections.length === 0) { toast.error("No collections selected to sort."); return; }
    setSpConfirmOpen(true);
  }

  async function spConfirmAndRun() {
    setSpConfirmOpen(false);
    setSpRunning(true);
    setSpRunSummary(null);

    const initialProgress: CollectionProgress[] = spSortableCollections.map((c) => ({
      id: c.id, title: c.title, status: "pending",
    }));
    setSpCollectionProgress(initialProgress);
    setSpCollectionProgress((prev) => prev.map((p, i) => (i === 0 ? { ...p, status: "processing" } : p)));

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/collection-sort-manager`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "run_sales_sort",
          storeId: selectedStoreId,
          collections: spSortableCollections.map((c) => c.id),
          sortRule: spSortRule,
          inStockFirst: spInStockFirst,
          salesWindowDays: spSalesWindow,
        }),
      });
      if (!response.ok || !response.body) throw new Error(`Edge function returned ${response.status}`);

      let processedCount = 0;
      let summaryReceived = false;
      await readNdjsonStream(response, (data) => {
        if (data.type === "summary") {
          summaryReceived = true;
          setSpRunSummary({ collectionsTotal: data.collectionsTotal as number, collectionsSorted: data.collectionsSorted as number, totalProductsReordered: data.totalProductsReordered as number, errors: (data.errors as RunSummary["errors"]) ?? [], runAt: data.runAt as string });
          queryClient.invalidateQueries({ queryKey: ["collection-sort-all-runs"] });
          return;
        }
        processedCount++;
        const nextIndex = processedCount;
        setSpCollectionProgress((prev) =>
          prev.map((p, idx) => {
            if (p.id === data.collectionId) return { ...p, status: data.status as CollectionProgress["status"], productsReordered: data.productsReordered as number | undefined, error: data.error as string | undefined };
            if (idx === nextIndex && p.status === "pending") return { ...p, status: "processing" };
            return p;
          }),
        );
      });
      // See confirmAndRun above: a clean-but-early connection close never
      // throws, so without this check a stuck "processing" row would never
      // get marked failed.
      if (!summaryReceived) {
        const msg = "Connection closed before the run finished";
        toast.error(`Sales sort failed: ${msg}`);
        failStalledProgress(setSpCollectionProgress, msg);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Sales sort failed: ${msg}`);
      failStalledProgress(setSpCollectionProgress, msg);
    } finally {
      setSpRunning(false);
    }
  }

  const spDoneCount = spCollectionProgress.filter((p) => p.status === "done" || p.status === "failed").length;
  const spProgressPercent = spCollectionProgress.length > 0 ? Math.round((spDoneCount / spCollectionProgress.length) * 100) : 0;
  const spCurrentlyProcessing = spCollectionProgress.find((p) => p.status === "processing");

  // ── Module 2 run ─────────────────────────────────────────────────────────────
  function openDcConfirmModal() {
    if (dcSortableCollections.length === 0) { toast.error("No collections selected to sort."); return; }
    setDcConfirmOpen(true);
  }

  async function dcConfirmAndRun() {
    setDcConfirmOpen(false);
    setDcRunning(true);
    setDcRunSummary(null);

    const initialProgress: CollectionProgress[] = dcSortableCollections.map((c) => ({
      id: c.id, title: c.title, status: "pending",
    }));
    setDcCollectionProgress(initialProgress);
    setDcCollectionProgress((prev) => prev.map((p, i) => (i === 0 ? { ...p, status: "processing" } : p)));

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/collection-sort-manager`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "run_discount_sort",
          storeId: selectedStoreId,
          collections: dcSortableCollections.map((c) => c.id),
          sortRule: dcSortRule,
          inStockFirst: dcInStockFirst,
        }),
      });
      if (!response.ok || !response.body) throw new Error(`Edge function returned ${response.status}`);

      let processedCount = 0;
      let summaryReceived = false;
      await readNdjsonStream(response, (data) => {
        if (data.type === "summary") {
          summaryReceived = true;
          setDcRunSummary({ collectionsTotal: data.collectionsTotal as number, collectionsSorted: data.collectionsSorted as number, totalProductsReordered: data.totalProductsReordered as number, errors: (data.errors as RunSummary["errors"]) ?? [], runAt: data.runAt as string });
          queryClient.invalidateQueries({ queryKey: ["collection-sort-all-runs"] });
          return;
        }
        processedCount++;
        const nextIndex = processedCount;
        setDcCollectionProgress((prev) =>
          prev.map((p, idx) => {
            if (p.id === data.collectionId) return { ...p, status: data.status as CollectionProgress["status"], productsReordered: data.productsReordered as number | undefined, error: data.error as string | undefined };
            if (idx === nextIndex && p.status === "pending") return { ...p, status: "processing" };
            return p;
          }),
        );
      });
      // See confirmAndRun above: a clean-but-early connection close never
      // throws, so without this check a stuck "processing" row would never
      // get marked failed.
      if (!summaryReceived) {
        const msg = "Connection closed before the run finished";
        toast.error(`Discount sort failed: ${msg}`);
        failStalledProgress(setDcCollectionProgress, msg);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Discount sort failed: ${msg}`);
      failStalledProgress(setDcCollectionProgress, msg);
    } finally {
      setDcRunning(false);
    }
  }

  const dcDoneCount = dcCollectionProgress.filter((p) => p.status === "done" || p.status === "failed").length;
  const dcProgressPercent = dcCollectionProgress.length > 0 ? Math.round((dcDoneCount / dcCollectionProgress.length) * 100) : 0;
  const dcCurrentlyProcessing = dcCollectionProgress.find((p) => p.status === "processing");

  // ── Module 3 run ─────────────────────────────────────────────────────────────
  function openInvConfirmModal() {
    if (invSortableCollections.length === 0) { toast.error("No collections selected to sort."); return; }
    setInvConfirmOpen(true);
  }

  async function invConfirmAndRun() {
    setInvConfirmOpen(false);
    setInvRunning(true);
    setInvRunSummary(null);

    const initialProgress: CollectionProgress[] = invSortableCollections.map((c) => ({
      id: c.id, title: c.title, status: "pending",
    }));
    setInvCollectionProgress(initialProgress);
    setInvCollectionProgress((prev) => prev.map((p, i) => (i === 0 ? { ...p, status: "processing" } : p)));

    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/collection-sort-manager`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "run_inventory_sort",
          storeId: selectedStoreId,
          collections: invSortableCollections.map((c) => c.id),
          sortRule: invSortRule,
          lowStockThreshold,
          overstockThreshold,
          inStockFirst: invInStockFirst,
        }),
      });
      if (!response.ok || !response.body) throw new Error(`Edge function returned ${response.status}`);

      let processedCount = 0;
      let summaryReceived = false;
      await readNdjsonStream(response, (data) => {
        if (data.type === "summary") {
          summaryReceived = true;
          setInvRunSummary({ collectionsTotal: data.collectionsTotal as number, collectionsSorted: data.collectionsSorted as number, totalProductsReordered: data.totalProductsReordered as number, errors: (data.errors as RunSummary["errors"]) ?? [], runAt: data.runAt as string });
          queryClient.invalidateQueries({ queryKey: ["collection-sort-all-runs"] });
          return;
        }
        processedCount++;
        const nextIndex = processedCount;
        setInvCollectionProgress((prev) =>
          prev.map((p, idx) => {
            if (p.id === data.collectionId) return { ...p, status: data.status as CollectionProgress["status"], productsReordered: data.productsReordered as number | undefined, error: data.error as string | undefined };
            if (idx === nextIndex && p.status === "pending") return { ...p, status: "processing" };
            return p;
          }),
        );
      });
      // See confirmAndRun above: a clean-but-early connection close never
      // throws, so without this check a stuck "processing" row would never
      // get marked failed.
      if (!summaryReceived) {
        const msg = "Connection closed before the run finished";
        toast.error(`Inventory sort failed: ${msg}`);
        failStalledProgress(setInvCollectionProgress, msg);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Inventory sort failed: ${msg}`);
      failStalledProgress(setInvCollectionProgress, msg);
    } finally {
      setInvRunning(false);
    }
  }

  const invDoneCount = invCollectionProgress.filter((p) => p.status === "done" || p.status === "failed").length;
  const invProgressPercent = invCollectionProgress.length > 0 ? Math.round((invDoneCount / invCollectionProgress.length) * 100) : 0;
  const invCurrentlyProcessing = invCollectionProgress.find((p) => p.status === "processing");

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
            {loadingCollections ? (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading collections…
              </span>
            ) : selectedStoreId && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => fetchCollections(selectedStoreId)}
                title="Refresh collection names from Shopify"
              >
                <RefreshCw className="h-3 w-3 mr-1" /> Refresh
              </Button>
            )}
          </div>

          {/* collections/all setup banner */}
          {selectedStoreId && !loadingCollections && !hasAllCollection && (
            <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/30">
              <span className="text-amber-800 dark:text-amber-300">
                <strong>collections/all</strong> is not set up — that page cannot be sorted yet.
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-amber-400 text-amber-800 hover:bg-amber-100 dark:text-amber-300"
                disabled={settingUpAll}
                onClick={setupAllCollection}
              >
                {settingUpAll ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Setting up…</> : "Set up now"}
              </Button>
            </div>
          )}

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
          disabled={running || sortableCollections.length === 0 || loadingCollections || !canEdit}
        >
          {running ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sorting…</>
          ) : (
            <><ArrowUpDown className="h-4 w-4 mr-2" /> Run Sort</>
          )}
        </Button>
      </div>

      {prRunLog.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <SortHistorySection runs={prRunLog} formatConfig={formatPriorityConfig} />
          </CardContent>
        </Card>
      )}

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

      {/* ══════════════════════════════════════════════════════════════════════
           MODULE 1: Sales & Performance
          ══════════════════════════════════════════════════════════════════════ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sales &amp; Performance Sort</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Rank products by sales data from your synced order history.
          </p>

          {/* Sort rule selector */}
          <div className="flex items-center gap-3">
            <Label className="shrink-0 text-sm font-medium">Sort Rule</Label>
            <Select value={spSortRule} onValueChange={(v) => setSpSortRule(v as typeof spSortRule)}>
              <SelectTrigger className="w-[280px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="best_selling_first">Best Selling First (by order count)</SelectItem>
                <SelectItem value="units_sold_first">Most Units Sold (by quantity)</SelectItem>
                <SelectItem value="revenue_first">Revenue First (quantity × price)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Sales window selector */}
          <div className="flex items-center gap-3">
            <Label className="shrink-0 text-sm font-medium">Sales Window</Label>
            <Select value={String(spSalesWindow)} onValueChange={(v) => setSpSalesWindow(Number(v) as 30 | 60 | 90)}>
              <SelectTrigger className="w-[280px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="60">Last 60 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Stock status toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Stock Status</Label>
              <p className="text-xs text-muted-foreground">Push out-of-stock products to the bottom</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs ${!spInStockFirst ? "text-foreground font-medium" : "text-muted-foreground"}`}>OOS First</span>
              <Switch checked={spInStockFirst} onCheckedChange={setSpInStockFirst} />
              <span className={`text-xs ${spInStockFirst ? "text-foreground font-medium" : "text-muted-foreground"}`}>In-Stock First</span>
            </div>
          </div>

          {/* Two-panel collection selector */}
          <div className="grid grid-cols-2 gap-4">
            <div className="border rounded-md flex flex-col">
              <div className="p-3 border-b bg-muted/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    Include Collections
                    <Badge variant="secondary" className="ml-2">{spIncludedCollections.length}</Badge>
                  </span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={spSelectAll}>
                      <CheckSquare className="h-3 w-3 mr-1" /> All
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={spDeselectAll}>
                      <Square className="h-3 w-3 mr-1" /> None
                    </Button>
                  </div>
                </div>
                <Input placeholder="Search collections…" value={spIncludeSearch} onChange={(e) => setSpIncludeSearch(e.target.value)} className="h-7 text-xs" />
              </div>
              <ScrollArea className="h-56">
                <div className="p-1">
                  {spFilteredIncluded.length === 0 && (
                    <p className="text-xs text-muted-foreground p-3 text-center">{loadingCollections ? "Loading…" : "No collections"}</p>
                  )}
                  {spFilteredIncluded.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 group">
                      <Checkbox checked={spCheckedIds.has(c.id)} onCheckedChange={() => spToggleChecked(c.id)} />
                      <span className="text-xs flex-1 truncate" title={c.title}>{c.title}</span>
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive" title="Move to Exclude" onClick={() => spMoveToExclude(c.id)}>
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="p-2 border-t bg-muted/20 text-xs text-muted-foreground">
                {spSortableCollections.length} selected for sort
              </div>
            </div>
            <div className="border rounded-md flex flex-col">
              <div className="p-3 border-b bg-muted/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    Exclude Collections
                    <Badge variant="outline" className="ml-2">{spExcludedCollections.length}</Badge>
                  </span>
                </div>
                <Input placeholder="Search excluded…" value={spExcludeSearch} onChange={(e) => setSpExcludeSearch(e.target.value)} className="h-7 text-xs" />
              </div>
              <ScrollArea className="h-56">
                <div className="p-1">
                  {spFilteredExcluded.length === 0 && (
                    <p className="text-xs text-muted-foreground p-3 text-center">No excluded collections</p>
                  )}
                  {spFilteredExcluded.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 group">
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary" title="Move back to Include" onClick={() => spMoveToInclude(c.id)}>
                        <ChevronLeft className="h-3 w-3" />
                      </Button>
                      <span className="text-xs flex-1 truncate line-through text-muted-foreground" title={c.title}>{c.title}</span>
                      <X className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 cursor-pointer hover:text-destructive" onClick={() => spMoveToInclude(c.id)} />
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="p-2 border-t bg-muted/20 text-xs text-muted-foreground">These will be skipped</div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button size="lg" className="px-10 text-base font-semibold" onClick={openSpConfirmModal} disabled={spRunning || spSortableCollections.length === 0 || loadingCollections || !canEdit}>
              {spRunning ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sorting…</> : <><ArrowUpDown className="h-4 w-4 mr-2" /> Run Sales Sort</>}
            </Button>
          </div>

          <SortHistorySection runs={spRunLog} formatConfig={formatSalesConfig} />
        </CardContent>
      </Card>

      {/* Module 1 progress */}
      {spCollectionProgress.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Sales Sort Progress</span>
              <Badge variant={spRunning ? "secondary" : spRunSummary ? "default" : "outline"}>
                {spRunning ? "Running" : spRunSummary ? "Complete" : "Idle"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{spDoneCount} / {spCollectionProgress.length} collections</span>
                <span>{spProgressPercent}%</span>
              </div>
              <Progress value={spProgressPercent} className="h-2" />
            </div>
            {spCurrentlyProcessing && (
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                <span>Processing: <strong>{spCurrentlyProcessing.title}</strong></span>
              </div>
            )}
            <ScrollArea className="h-64">
              <div className="space-y-1">
                {spCollectionProgress.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-2 py-1.5 rounded text-sm">
                    <span className="shrink-0">
                      {item.status === "pending" && <span className="h-2 w-2 rounded-full bg-muted-foreground/30 inline-block" />}
                      {item.status === "processing" && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                      {item.status === "done" && <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />}
                      {item.status === "failed" && <span className="h-2 w-2 rounded-full bg-destructive inline-block" />}
                    </span>
                    <span className="flex-1 truncate">{item.title}</span>
                    {item.status === "done" && <span className="text-xs text-muted-foreground shrink-0">{item.productsReordered} products</span>}
                    {item.status === "failed" && <span className="text-xs text-destructive shrink-0 max-w-[180px] truncate" title={item.error}>{item.error}</span>}
                    <Badge variant={item.status === "done" ? "default" : item.status === "failed" ? "destructive" : item.status === "processing" ? "secondary" : "outline"} className="text-xs h-5 shrink-0">
                      {item.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Module 1 run summary */}
      {spRunSummary && (
        <Card>
          <CardHeader><CardTitle className="text-base">Sales Sort Summary</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-muted rounded-md p-3 text-center">
                <p className="text-2xl font-bold">{spRunSummary.collectionsSorted}</p>
                <p className="text-xs text-muted-foreground">Collections sorted</p>
              </div>
              <div className="bg-muted rounded-md p-3 text-center">
                <p className="text-2xl font-bold">{spRunSummary.totalProductsReordered}</p>
                <p className="text-xs text-muted-foreground">Products reordered</p>
              </div>
              <div className="bg-muted rounded-md p-3 text-center">
                <p className={`text-2xl font-bold ${spRunSummary.errors.length > 0 ? "text-destructive" : "text-emerald-500"}`}>{spRunSummary.errors.length}</p>
                <p className="text-xs text-muted-foreground">Errors</p>
              </div>
            </div>
            {spRunSummary.errors.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">Failed collections:</p>
                {spRunSummary.errors.map((err, i) => (
                  <div key={i} className="text-xs bg-destructive/10 rounded p-2">
                    <span className="font-medium">{err.title}</span>
                    <span className="text-muted-foreground ml-2">{err.error}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Completed at {new Date(spRunSummary.runAt).toLocaleString()}</p>
          </CardContent>
        </Card>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
           MODULE 2: Discount & Campaign
          ══════════════════════════════════════════════════════════════════════ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Discount &amp; Campaign Sort</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Surface discounted products by comparing price vs compare-at price.
          </p>

          {/* Sort rule selector */}
          <div className="flex items-center gap-3">
            <Label className="shrink-0 text-sm font-medium">Sort Rule</Label>
            <Select value={dcSortRule} onValueChange={(v) => setDcSortRule(v as typeof dcSortRule)}>
              <SelectTrigger className="w-[320px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="discounted_first">Discounted Products First</SelectItem>
                <SelectItem value="highest_discount_first">Highest Discount % First</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Stock status toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Stock Status</Label>
              <p className="text-xs text-muted-foreground">Push out-of-stock products to the bottom</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs ${!dcInStockFirst ? "text-foreground font-medium" : "text-muted-foreground"}`}>OOS First</span>
              <Switch checked={dcInStockFirst} onCheckedChange={setDcInStockFirst} />
              <span className={`text-xs ${dcInStockFirst ? "text-foreground font-medium" : "text-muted-foreground"}`}>In-Stock First</span>
            </div>
          </div>

          {/* Two-panel collection selector */}
          <div className="grid grid-cols-2 gap-4">
            <div className="border rounded-md flex flex-col">
              <div className="p-3 border-b bg-muted/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    Include Collections
                    <Badge variant="secondary" className="ml-2">{dcIncludedCollections.length}</Badge>
                  </span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={dcSelectAll}>
                      <CheckSquare className="h-3 w-3 mr-1" /> All
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={dcDeselectAll}>
                      <Square className="h-3 w-3 mr-1" /> None
                    </Button>
                  </div>
                </div>
                <Input placeholder="Search collections…" value={dcIncludeSearch} onChange={(e) => setDcIncludeSearch(e.target.value)} className="h-7 text-xs" />
              </div>
              <ScrollArea className="h-56">
                <div className="p-1">
                  {dcFilteredIncluded.length === 0 && (
                    <p className="text-xs text-muted-foreground p-3 text-center">{loadingCollections ? "Loading…" : "No collections"}</p>
                  )}
                  {dcFilteredIncluded.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 group">
                      <Checkbox checked={dcCheckedIds.has(c.id)} onCheckedChange={() => dcToggleChecked(c.id)} />
                      <span className="text-xs flex-1 truncate" title={c.title}>{c.title}</span>
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive" title="Move to Exclude" onClick={() => dcMoveToExclude(c.id)}>
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="p-2 border-t bg-muted/20 text-xs text-muted-foreground">
                {dcSortableCollections.length} selected for sort
              </div>
            </div>
            <div className="border rounded-md flex flex-col">
              <div className="p-3 border-b bg-muted/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    Exclude Collections
                    <Badge variant="outline" className="ml-2">{dcExcludedCollections.length}</Badge>
                  </span>
                </div>
                <Input placeholder="Search excluded…" value={dcExcludeSearch} onChange={(e) => setDcExcludeSearch(e.target.value)} className="h-7 text-xs" />
              </div>
              <ScrollArea className="h-56">
                <div className="p-1">
                  {dcFilteredExcluded.length === 0 && (
                    <p className="text-xs text-muted-foreground p-3 text-center">No excluded collections</p>
                  )}
                  {dcFilteredExcluded.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 group">
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary" title="Move back to Include" onClick={() => dcMoveToInclude(c.id)}>
                        <ChevronLeft className="h-3 w-3" />
                      </Button>
                      <span className="text-xs flex-1 truncate line-through text-muted-foreground" title={c.title}>{c.title}</span>
                      <X className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 cursor-pointer hover:text-destructive" onClick={() => dcMoveToInclude(c.id)} />
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="p-2 border-t bg-muted/20 text-xs text-muted-foreground">These will be skipped</div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button size="lg" className="px-10 text-base font-semibold" onClick={openDcConfirmModal} disabled={dcRunning || dcSortableCollections.length === 0 || loadingCollections}>
              {dcRunning ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sorting…</> : <><ArrowUpDown className="h-4 w-4 mr-2" /> Run Discount Sort</>}
            </Button>
          </div>

          <SortHistorySection runs={dcRunLog} formatConfig={formatDiscountConfig} />
        </CardContent>
      </Card>

      {/* Module 2 progress */}
      {dcCollectionProgress.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Discount Sort Progress</span>
              <Badge variant={dcRunning ? "secondary" : dcRunSummary ? "default" : "outline"}>
                {dcRunning ? "Running" : dcRunSummary ? "Complete" : "Idle"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{dcDoneCount} / {dcCollectionProgress.length} collections</span>
                <span>{dcProgressPercent}%</span>
              </div>
              <Progress value={dcProgressPercent} className="h-2" />
            </div>
            {dcCurrentlyProcessing && (
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                <span>Processing: <strong>{dcCurrentlyProcessing.title}</strong></span>
              </div>
            )}
            <ScrollArea className="h-64">
              <div className="space-y-1">
                {dcCollectionProgress.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-2 py-1.5 rounded text-sm">
                    <span className="shrink-0">
                      {item.status === "pending" && <span className="h-2 w-2 rounded-full bg-muted-foreground/30 inline-block" />}
                      {item.status === "processing" && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                      {item.status === "done" && <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />}
                      {item.status === "failed" && <span className="h-2 w-2 rounded-full bg-destructive inline-block" />}
                    </span>
                    <span className="flex-1 truncate">{item.title}</span>
                    {item.status === "done" && <span className="text-xs text-muted-foreground shrink-0">{item.productsReordered} products</span>}
                    {item.status === "failed" && <span className="text-xs text-destructive shrink-0 max-w-[180px] truncate" title={item.error}>{item.error}</span>}
                    <Badge variant={item.status === "done" ? "default" : item.status === "failed" ? "destructive" : item.status === "processing" ? "secondary" : "outline"} className="text-xs h-5 shrink-0">
                      {item.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Module 2 run summary */}
      {dcRunSummary && (
        <Card>
          <CardHeader><CardTitle className="text-base">Discount Sort Summary</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-muted rounded-md p-3 text-center">
                <p className="text-2xl font-bold">{dcRunSummary.collectionsSorted}</p>
                <p className="text-xs text-muted-foreground">Collections sorted</p>
              </div>
              <div className="bg-muted rounded-md p-3 text-center">
                <p className="text-2xl font-bold">{dcRunSummary.totalProductsReordered}</p>
                <p className="text-xs text-muted-foreground">Products reordered</p>
              </div>
              <div className="bg-muted rounded-md p-3 text-center">
                <p className={`text-2xl font-bold ${dcRunSummary.errors.length > 0 ? "text-destructive" : "text-emerald-500"}`}>{dcRunSummary.errors.length}</p>
                <p className="text-xs text-muted-foreground">Errors</p>
              </div>
            </div>
            {dcRunSummary.errors.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">Failed collections:</p>
                {dcRunSummary.errors.map((err, i) => (
                  <div key={i} className="text-xs bg-destructive/10 rounded p-2">
                    <span className="font-medium">{err.title}</span>
                    <span className="text-muted-foreground ml-2">{err.error}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Completed at {new Date(dcRunSummary.runAt).toLocaleString()}</p>
          </CardContent>
        </Card>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
           MODULE 3: Inventory
          ══════════════════════════════════════════════════════════════════════ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inventory Sort</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Sort products by stock level to drive urgency or clear overstock.
          </p>

          {/* Sort rule selector */}
          <div className="flex items-center gap-3">
            <Label className="shrink-0 text-sm font-medium">Sort Rule</Label>
            <Select value={invSortRule} onValueChange={(v) => setInvSortRule(v as typeof invSortRule)}>
              <SelectTrigger className="w-[320px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low_stock_first">Low Stock First (Urgency)</SelectItem>
                <SelectItem value="overstock_first">Overstock First (Clearance)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Threshold inputs */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Label className="text-xs shrink-0">Low stock threshold</Label>
              <Input
                type="number"
                min={1}
                value={lowStockThreshold}
                onChange={(e) => setLowStockThreshold(Math.max(1, Number(e.target.value)))}
                className="h-7 w-20 text-xs"
              />
              <span className="text-xs text-muted-foreground">units</span>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs shrink-0">Overstock threshold</Label>
              <Input
                type="number"
                min={1}
                value={overstockThreshold}
                onChange={(e) => setOverstockThreshold(Math.max(1, Number(e.target.value)))}
                className="h-7 w-20 text-xs"
              />
              <span className="text-xs text-muted-foreground">units</span>
            </div>
          </div>

          {/* Stock status toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Stock Status</Label>
              <p className="text-xs text-muted-foreground">Push out-of-stock products to the bottom</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs ${!invInStockFirst ? "text-foreground font-medium" : "text-muted-foreground"}`}>OOS First</span>
              <Switch checked={invInStockFirst} onCheckedChange={setInvInStockFirst} />
              <span className={`text-xs ${invInStockFirst ? "text-foreground font-medium" : "text-muted-foreground"}`}>In-Stock First</span>
            </div>
          </div>

          {/* Two-panel collection selector */}
          <div className="grid grid-cols-2 gap-4">
            <div className="border rounded-md flex flex-col">
              <div className="p-3 border-b bg-muted/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    Include Collections
                    <Badge variant="secondary" className="ml-2">{invIncludedCollections.length}</Badge>
                  </span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={invSelectAll}>
                      <CheckSquare className="h-3 w-3 mr-1" /> All
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={invDeselectAll}>
                      <Square className="h-3 w-3 mr-1" /> None
                    </Button>
                  </div>
                </div>
                <Input placeholder="Search collections…" value={invIncludeSearch} onChange={(e) => setInvIncludeSearch(e.target.value)} className="h-7 text-xs" />
              </div>
              <ScrollArea className="h-56">
                <div className="p-1">
                  {invFilteredIncluded.length === 0 && (
                    <p className="text-xs text-muted-foreground p-3 text-center">{loadingCollections ? "Loading…" : "No collections"}</p>
                  )}
                  {invFilteredIncluded.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 group">
                      <Checkbox checked={invCheckedIds.has(c.id)} onCheckedChange={() => invToggleChecked(c.id)} />
                      <span className="text-xs flex-1 truncate" title={c.title}>{c.title}</span>
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive" title="Move to Exclude" onClick={() => invMoveToExclude(c.id)}>
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="p-2 border-t bg-muted/20 text-xs text-muted-foreground">
                {invSortableCollections.length} selected for sort
              </div>
            </div>
            <div className="border rounded-md flex flex-col">
              <div className="p-3 border-b bg-muted/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    Exclude Collections
                    <Badge variant="outline" className="ml-2">{invExcludedCollections.length}</Badge>
                  </span>
                </div>
                <Input placeholder="Search excluded…" value={invExcludeSearch} onChange={(e) => setInvExcludeSearch(e.target.value)} className="h-7 text-xs" />
              </div>
              <ScrollArea className="h-56">
                <div className="p-1">
                  {invFilteredExcluded.length === 0 && (
                    <p className="text-xs text-muted-foreground p-3 text-center">No excluded collections</p>
                  )}
                  {invFilteredExcluded.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 group">
                      <Button variant="ghost" size="sm" className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary" title="Move back to Include" onClick={() => invMoveToInclude(c.id)}>
                        <ChevronLeft className="h-3 w-3" />
                      </Button>
                      <span className="text-xs flex-1 truncate line-through text-muted-foreground" title={c.title}>{c.title}</span>
                      <X className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 cursor-pointer hover:text-destructive" onClick={() => invMoveToInclude(c.id)} />
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="p-2 border-t bg-muted/20 text-xs text-muted-foreground">These will be skipped</div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button size="lg" className="px-10 text-base font-semibold" onClick={openInvConfirmModal} disabled={invRunning || invSortableCollections.length === 0 || loadingCollections}>
              {invRunning ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sorting…</> : <><ArrowUpDown className="h-4 w-4 mr-2" /> Run Inventory Sort</>}
            </Button>
          </div>

          <SortHistorySection runs={ivRunLog} formatConfig={formatInventoryConfig} />
        </CardContent>
      </Card>

      {/* Module 3 progress */}
      {invCollectionProgress.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Inventory Sort Progress</span>
              <Badge variant={invRunning ? "secondary" : invRunSummary ? "default" : "outline"}>
                {invRunning ? "Running" : invRunSummary ? "Complete" : "Idle"}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{invDoneCount} / {invCollectionProgress.length} collections</span>
                <span>{invProgressPercent}%</span>
              </div>
              <Progress value={invProgressPercent} className="h-2" />
            </div>
            {invCurrentlyProcessing && (
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                <span>Processing: <strong>{invCurrentlyProcessing.title}</strong></span>
              </div>
            )}
            <ScrollArea className="h-64">
              <div className="space-y-1">
                {invCollectionProgress.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-2 py-1.5 rounded text-sm">
                    <span className="shrink-0">
                      {item.status === "pending" && <span className="h-2 w-2 rounded-full bg-muted-foreground/30 inline-block" />}
                      {item.status === "processing" && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                      {item.status === "done" && <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />}
                      {item.status === "failed" && <span className="h-2 w-2 rounded-full bg-destructive inline-block" />}
                    </span>
                    <span className="flex-1 truncate">{item.title}</span>
                    {item.status === "done" && <span className="text-xs text-muted-foreground shrink-0">{item.productsReordered} products</span>}
                    {item.status === "failed" && <span className="text-xs text-destructive shrink-0 max-w-[180px] truncate" title={item.error}>{item.error}</span>}
                    <Badge variant={item.status === "done" ? "default" : item.status === "failed" ? "destructive" : item.status === "processing" ? "secondary" : "outline"} className="text-xs h-5 shrink-0">
                      {item.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Module 3 run summary */}
      {invRunSummary && (
        <Card>
          <CardHeader><CardTitle className="text-base">Inventory Sort Summary</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-muted rounded-md p-3 text-center">
                <p className="text-2xl font-bold">{invRunSummary.collectionsSorted}</p>
                <p className="text-xs text-muted-foreground">Collections sorted</p>
              </div>
              <div className="bg-muted rounded-md p-3 text-center">
                <p className="text-2xl font-bold">{invRunSummary.totalProductsReordered}</p>
                <p className="text-xs text-muted-foreground">Products reordered</p>
              </div>
              <div className="bg-muted rounded-md p-3 text-center">
                <p className={`text-2xl font-bold ${invRunSummary.errors.length > 0 ? "text-destructive" : "text-emerald-500"}`}>{invRunSummary.errors.length}</p>
                <p className="text-xs text-muted-foreground">Errors</p>
              </div>
            </div>
            {invRunSummary.errors.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">Failed collections:</p>
                {invRunSummary.errors.map((err, i) => (
                  <div key={i} className="text-xs bg-destructive/10 rounded p-2">
                    <span className="font-medium">{err.title}</span>
                    <span className="text-muted-foreground ml-2">{err.error}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Completed at {new Date(invRunSummary.runAt).toLocaleString()}</p>
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

      {/* ── Module 1 Confirmation Modal ── */}
      <Dialog open={spConfirmOpen} onOpenChange={setSpConfirmOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm Sales Sort Run</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Store</p>
              <p className="font-medium">{selectedStore?.store_name ?? "Unknown"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Sort Rule</p>
              <p className="font-medium">{spSortRule === "best_selling_first" ? "Best Selling First (by order count)" : "Revenue First (quantity × price)"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Sales Window</p>
              <p className="font-medium">Last {spSalesWindow} days</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Stock Status</p>
              <p className="font-medium">{spInStockFirst ? "In-Stock First" : "Out-of-Stock First"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Collections to sort ({spSortableCollections.length})
              </p>
              <ScrollArea className="h-32 border rounded-md">
                <div className="p-2 space-y-0.5">
                  {spSortableCollections.map((c) => (
                    <p key={c.id} className="text-xs py-0.5">{c.title}</p>
                  ))}
                </div>
              </ScrollArea>
            </div>
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                This will permanently reorder products in the selected collections. This cannot be automatically undone.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSpConfirmOpen(false)}>Cancel</Button>
            <Button onClick={spConfirmAndRun}>Confirm &amp; Run Sales Sort</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Module 2 Confirmation Modal ── */}
      <Dialog open={dcConfirmOpen} onOpenChange={setDcConfirmOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm Discount Sort Run</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Store</p>
              <p className="font-medium">{selectedStore?.store_name ?? "Unknown"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Sort Rule</p>
              <p className="font-medium">{dcSortRule === "discounted_first" ? "Discounted Products First" : "Highest Discount % First"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Stock Status</p>
              <p className="font-medium">{dcInStockFirst ? "In-Stock First" : "Out-of-Stock First"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Collections to sort ({dcSortableCollections.length})
              </p>
              <ScrollArea className="h-32 border rounded-md">
                <div className="p-2 space-y-0.5">
                  {dcSortableCollections.map((c) => (
                    <p key={c.id} className="text-xs py-0.5">{c.title}</p>
                  ))}
                </div>
              </ScrollArea>
            </div>
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                This will permanently reorder products in the selected collections. This cannot be automatically undone.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDcConfirmOpen(false)}>Cancel</Button>
            <Button onClick={dcConfirmAndRun}>Confirm &amp; Run Discount Sort</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Module 3 Confirmation Modal ── */}
      <Dialog open={invConfirmOpen} onOpenChange={setInvConfirmOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm Inventory Sort Run</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Store</p>
              <p className="font-medium">{selectedStore?.store_name ?? "Unknown"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Sort Rule</p>
              <p className="font-medium">
                {invSortRule === "low_stock_first"
                  ? `Low Stock First — threshold: ${lowStockThreshold} units`
                  : `Overstock First — threshold: ${overstockThreshold} units`}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Stock Status</p>
              <p className="font-medium">{invInStockFirst ? "In-Stock First" : "Out-of-Stock First"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Collections to sort ({invSortableCollections.length})
              </p>
              <ScrollArea className="h-32 border rounded-md">
                <div className="p-2 space-y-0.5">
                  {invSortableCollections.map((c) => (
                    <p key={c.id} className="text-xs py-0.5">{c.title}</p>
                  ))}
                </div>
              </ScrollArea>
            </div>
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                This will permanently reorder products in the selected collections. This cannot be automatically undone.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvConfirmOpen(false)}>Cancel</Button>
            <Button onClick={invConfirmAndRun}>Confirm &amp; Run Inventory Sort</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
