import { useState } from "react";
import {
  BarChart2, Clock, Truck, Globe, TrendingDown, Award, Users,
  AlertTriangle, Megaphone, Plus, Search, Share2, Save, Play,
  Pause, MoreHorizontal, Calendar, Download, LayoutTemplate,
  SlidersHorizontal, Table2, PieChart as PieIcon, LineChart as LineIcon, Hash,
  GripVertical, X, ChevronRight, ArrowLeft,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { reportTemplates } from "./mockData";
import { useSavedReports, useReportSchedules, type SavedReport, type ReportSchedule } from "@/hooks/useReports";

import FunctionalCustomBuilder from "./components/FunctionalCustomBuilder";
import {
  SalesOverviewReport,
  TopProductsReport,
  InventoryHealthReport,
  FulfillmentReport,
  CollectionPerformanceReport,
} from "./components/ReportPanels";

// ─── Template → report panel mapping ─────────────────────────────────────────

type ReportKey = "sales-overview" | "top-products" | "inventory-health" | "fulfillment" | "collection-performance";

const TEMPLATE_REPORT_MAP: Record<string, ReportKey> = {
  "sales-overview":           "sales-overview",
  "revenue-by-channel":       "sales-overview",
  "sales-by-channel":         "sales-overview",
  "top-products":             "top-products",
  "products-by-revenue":      "top-products",
  "best-sellers":             "top-products",
  "inventory-health":         "inventory-health",
  "inventory":                "inventory-health",
  "stock-levels":             "inventory-health",
  "fulfillment":              "fulfillment",
  "fulfillment-report":       "fulfillment",
  "order-fulfillment":        "fulfillment",
  "collection-performance":   "collection-performance",
  "collections":              "collection-performance",
};

function resolveReportKey(tpl: typeof reportTemplates[number]): ReportKey | null {
  const slug = tpl.id?.toLowerCase().replace(/\s+/g, "-") ?? "";
  const name = tpl.name?.toLowerCase().replace(/\s+/g, "-") ?? "";
  const cat  = tpl.category?.toLowerCase() ?? "";
  return (
    TEMPLATE_REPORT_MAP[slug] ??
    TEMPLATE_REPORT_MAP[name] ??
    (cat === "inventory"  ? "inventory-health" :
     cat === "sales"      ? "sales-overview" :
     cat === "vendors"    ? "top-products" :
     cat === "customers"  ? "sales-overview" :
     cat === "marketing"  ? "collection-performance" : null)
  );
}

function ReportPanel({ reportKey, onBack }: { reportKey: ReportKey; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <button onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft size={13} /> Back to templates
      </button>
      {reportKey === "sales-overview"         && <SalesOverviewReport />}
      {reportKey === "top-products"           && <TopProductsReport />}
      {reportKey === "inventory-health"       && <InventoryHealthReport />}
      {reportKey === "fulfillment"            && <FulfillmentReport />}
      {reportKey === "collection-performance" && <CollectionPerformanceReport />}
    </div>
  );
}

// ─── Icon map ─────────────────────────────────────────────────────────────────

const iconMap: Record<string, LucideIcon> = {
  BarChart2, Clock, Truck, Globe, TrendingDown, Award, Users, AlertTriangle, Megaphone,
};

// ─── Template card ────────────────────────────────────────────────────────────

function TemplateCard({ tpl, onRun }: { tpl: typeof reportTemplates[number]; onRun: () => void }) {
  const Icon = iconMap[tpl.icon] ?? BarChart2;
  return (
    <Card className="cursor-pointer transition-all hover:shadow-md hover:border-border/80 group">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: tpl.color + "1A", color: tpl.color }}>
              <Icon size={17} strokeWidth={1.8} />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">{tpl.name}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{tpl.category}</p>
            </div>
          </div>
          <button className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
            <MoreHorizontal size={14} />
          </button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">{tpl.desc}</p>
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">
            <Clock size={11} />Last run {tpl.lastRun}
          </span>
          <button onClick={onRun}
            className="font-medium flex items-center gap-0.5 hover:underline"
            style={{ color: tpl.color }}>
            Run report <ChevronRight size={11} strokeWidth={2.5} />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Saved reports ────────────────────────────────────────────────────────────

function SavedRowSkeleton() {
  return (
    <tr className="border-b animate-pulse">
      <td className="px-4 py-3"><div className="h-3 bg-muted rounded w-44" /></td>
      <td className="px-4 py-3"><div className="h-3 bg-muted rounded w-28" /></td>
      <td className="px-4 py-3"><div className="h-3 bg-muted rounded w-20" /></td>
      <td className="px-4 py-3"><div className="h-3 bg-muted rounded w-24" /></td>
      <td className="px-4 py-3"><div className="h-3 bg-muted rounded w-16" /></td>
      <td className="px-4 py-3" />
    </tr>
  );
}

function SavedReportsTab({ reports, isLoading, search, onSearch, onRunReport }: {
  reports: SavedReport[];
  isLoading: boolean;
  search: string;
  onSearch: (s: string) => void;
  onRunReport: (r: SavedReport) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Saved reports</h3>
            {!isLoading && <span className="text-xs text-muted-foreground">{reports.length}</span>}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search saved reports…"
                className="pl-8 h-8 w-48 text-xs"
                value={search}
                onChange={e => onSearch(e.target.value)}
              />
            </div>
            <Button size="sm" className="h-8 gap-1.5 text-xs"><Plus size={12} /> New report</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b">
              {["Name", "Template", "Owner", "Last updated", "Schedule", ""].map((h, i) => (
                <th key={i} className="px-4 py-2.5 font-medium text-muted-foreground text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 3 }).map((_, i) => <SavedRowSkeleton key={i} />)
              : reports.length === 0
                ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        No saved reports yet. Create one from a template or the custom builder.
                      </td>
                    </tr>
                  )
                : reports.map(r => {
                    const initials = r.ownerName.split(" ").map(s => s[0]).join("").slice(0, 2).toUpperCase();
                    return (
                      <tr key={r.id} className="border-b last:border-b-0 hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <BarChart2 size={13} className="text-primary shrink-0" />
                            <span className="font-medium">{r.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{r.templateName ?? "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                              style={{ background: "linear-gradient(135deg, #8b5cf6, #ec4899)" }}>
                              {initials}
                            </span>
                            {r.ownerName}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{r.updatedAt}</td>
                        <td className="px-4 py-3">
                          {r.scheduleLabel
                            ? <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0 text-primary border-primary/30 bg-primary/5">
                                <Calendar size={10} /> {r.scheduleLabel}
                              </Badge>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <button onClick={() => onRunReport(r)}
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                              <Play size={13} />
                            </button>
                            <button className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><Share2 size={13} /></button>
                            <button className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><MoreHorizontal size={13} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ─── Scheduled tab ────────────────────────────────────────────────────────────

function ScheduleSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 border-t first:border-t-0 animate-pulse">
      <div className="w-8 h-8 rounded-lg bg-muted shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 bg-muted rounded w-48" />
        <div className="h-2.5 bg-muted rounded w-64" />
      </div>
      <div className="flex gap-1.5 shrink-0"><div className="h-4 w-10 bg-muted rounded" /></div>
      <div className="text-right min-w-[100px] space-y-1">
        <div className="h-2 bg-muted rounded w-12 ml-auto" />
        <div className="h-3 bg-muted rounded w-20 ml-auto" />
      </div>
      <div className="w-14" />
    </div>
  );
}

function ScheduledTab({ schedules, isLoading }: {
  schedules: ReportSchedule[];
  isLoading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Scheduled deliveries</h3>
          <Button size="sm" className="h-8 gap-1.5 text-xs"><Plus size={12} /> New schedule</Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => <ScheduleSkeleton key={i} />)
          : schedules.length === 0
            ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No scheduled deliveries. Set one up from a saved report.
                </div>
              )
            : schedules.map(s => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3.5 border-t first:border-t-0 hover:bg-muted/40 transition-colors">
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                    s.isActive ? "bg-primary/10" : "bg-muted"
                  )}>
                    <Calendar size={14} className={s.isActive ? "text-primary" : "text-muted-foreground"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.frequencyLabel} · to {s.recipientsLabel}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {s.formats.map(f => <Badge key={f} variant="outline" className="text-[10px] px-1.5 py-0">{f}</Badge>)}
                  </div>
                  <div className="text-right shrink-0 min-w-[100px]">
                    <p className="text-[10px] text-muted-foreground">Next run</p>
                    <p className="text-xs font-medium">{s.nextRunLabel}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                      {s.isActive ? <Pause size={13} /> : <Play size={13} />}
                    </button>
                    <button className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><MoreHorizontal size={13} /></button>
                  </div>
                </div>
              ))}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const CATEGORIES = ["All", "Sales", "Inventory", "Vendors", "Customers", "Marketing"];

export default function Reports() {
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [savedSearch, setSavedSearch] = useState("");
  const [activeTab, setActiveTab] = useState("templates");
  const [activeReport, setActiveReport] = useState<ReportKey | null>(null);

  const savedQ = useSavedReports(savedSearch);
  const scheduledQ = useReportSchedules();

  const filteredTemplates = categoryFilter === "All"
    ? reportTemplates
    : reportTemplates.filter(t => t.category === categoryFilter);

  const handleRunTemplate = (tpl: typeof reportTemplates[number]) => {
    const key = resolveReportKey(tpl);
    if (key) {
      setActiveReport(key);
    } else {
      // Fallback: open sales overview for unmapped templates
      setActiveReport("sales-overview");
    }
  };

  const handleRunSaved = (r: SavedReport) => {
    // Map saved report template name to a panel
    const slug = r.templateName?.toLowerCase().replace(/\s+/g, "-") ?? "";
    const key = TEMPLATE_REPORT_MAP[slug] ?? "sales-overview";
    setActiveReport(key);
    setActiveTab("templates");
  };

  return (
    <div className="p-6 space-y-4 max-w-[1600px]">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Pre-built reports, custom builder, and scheduled deliveries</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs"><Share2 size={13} /> Share library</Button>
          <Button size="sm" className="h-8 gap-1.5 text-xs"><Plus size={13} /> New report</Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={v => { setActiveTab(v); setActiveReport(null); }}>
        <TabsList className="h-9 gap-1">
          <TabsTrigger value="templates" className="gap-1.5 text-xs">
            <LayoutTemplate size={13} /> Templates
            <span className="ml-1 rounded-full bg-muted px-1.5 py-0 text-[10px] font-semibold text-muted-foreground">
              {reportTemplates.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="builder" className="gap-1.5 text-xs">
            <SlidersHorizontal size={13} /> Custom builder
          </TabsTrigger>
          <TabsTrigger value="saved" className="gap-1.5 text-xs">
            <Save size={13} /> Saved
            <span className="ml-1 rounded-full bg-muted px-1.5 py-0 text-[10px] font-semibold text-muted-foreground">
              {savedQ.data != null ? savedQ.data.length : "…"}
            </span>
          </TabsTrigger>
          <TabsTrigger value="scheduled" className="gap-1.5 text-xs">
            <Calendar size={13} /> Scheduled
            <span className="ml-1 rounded-full bg-muted px-1.5 py-0 text-[10px] font-semibold text-muted-foreground">
              {scheduledQ.data != null ? scheduledQ.data.length : "…"}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* Templates tab */}
        <TabsContent value="templates" className="mt-4 space-y-4">
          {activeReport ? (
            <ReportPanel reportKey={activeReport} onBack={() => setActiveReport(null)} />
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="flex rounded-md border overflow-hidden">
                  {CATEGORIES.map(c => (
                    <button key={c} onClick={() => setCategoryFilter(c)}
                      className={cn("px-3 py-1.5 text-xs font-medium transition-colors border-r last:border-r-0",
                        categoryFilter === c ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground")}>
                      {c}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="Search templates…" className="pl-8 h-8 w-52 text-xs" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3.5">
                {filteredTemplates.map(t => (
                  <TemplateCard key={t.id} tpl={t} onRun={() => handleRunTemplate(t)} />
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* Custom builder tab */}
        <TabsContent value="builder" className="mt-4">
          <FunctionalCustomBuilder />
        </TabsContent>

        {/* Saved tab */}
        <TabsContent value="saved" className="mt-4">
          <SavedReportsTab
            reports={savedQ.data ?? []}
            isLoading={savedQ.isLoading}
            search={savedSearch}
            onSearch={setSavedSearch}
            onRunReport={handleRunSaved}
          />
        </TabsContent>

        {/* Scheduled tab */}
        <TabsContent value="scheduled" className="mt-4">
          <ScheduledTab
            schedules={scheduledQ.data ?? []}
            isLoading={scheduledQ.isLoading}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
