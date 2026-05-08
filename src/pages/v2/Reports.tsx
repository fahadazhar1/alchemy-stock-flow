import { useState } from "react";
import {
  BarChart2, Clock, Truck, Globe, TrendingDown, Award, Users,
  AlertTriangle, Megaphone, Plus, Search, Share2, Save, Play,
  Pause, MoreHorizontal, Calendar, Download, LayoutTemplate,
  SlidersHorizontal, Table2, PieChart as PieIcon, LineChart as LineIcon, Hash,
  GripVertical, X, ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line, PieChart, Pie, Cell,
} from "recharts";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { fmtGBP, fmtNum, reportTemplates, salesTrend, channels } from "./mockData";
import { useSavedReports, useReportSchedules, type SavedReport, type ReportSchedule } from "@/hooks/useReports";

// ─── Icon map (for dynamic icon lookup) ─────────────────────────────────────

const iconMap: Record<string, LucideIcon> = {
  BarChart2, Clock, Truck, Globe, TrendingDown, Award, Users, AlertTriangle, Megaphone,
};

// ─── Template card ───────────────────────────────────────────────────────────

function TemplateCard({ tpl }: { tpl: typeof reportTemplates[number] }) {
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
          <span className="font-medium flex items-center gap-0.5" style={{ color: tpl.color }}>
            Run report <ChevronRight size={11} strokeWidth={2.5} />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Custom builder ──────────────────────────────────────────────────────────

type FieldType = "Metric" | "Dimension" | "Filter";
type ChartType = "bar" | "line" | "pie" | "table" | "kpi";

const fieldTypeCls: Record<FieldType, string> = {
  Metric:    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  Dimension: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400",
  Filter:    "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-400",
};
const slotAccent: Record<"metrics" | "dimensions" | "filters", string> = {
  metrics: "#10b981", dimensions: "#8b5cf6", filters: "#06b6d4",
};

const fieldLibrary: Record<FieldType, string[]> = {
  Metric:    ["Revenue","Orders","AOV","Units sold","Refunds","Margin","Sell-through %","Inventory units","Stock value","Days on shelf","Conversion %"],
  Dimension: ["Channel","Collection","Vendor","Store","Customer cohort","Day","Week","Month","Country","SKU"],
  Filter:    ["Date range","Status","Channel","Store","Tag","Vendor"],
};

function FieldChip({ name, type, onAdd }: { name: string; type: FieldType; onAdd: () => void }) {
  return (
    <button onClick={onAdd} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border bg-card hover:bg-muted text-xs transition-colors text-left w-full">
      <GripVertical size={11} className="text-muted-foreground shrink-0" />
      <span className="flex-1">{name}</span>
      <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded", fieldTypeCls[type])}>{type}</span>
    </button>
  );
}

function Slot({ label, items, kind, onRemove }:
  { label: string; items: string[]; kind: "metrics" | "dimensions" | "filters"; onRemove: (i: number) => void }) {
  const color = slotAccent[kind];
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">{label}</p>
      <div className={cn("min-h-16 rounded-lg p-2 flex flex-wrap gap-1.5 items-start",
        items.length ? "border bg-muted/50" : "border-2 border-dashed")}>
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground m-auto">Drop {label.toLowerCase()} here</p>
        )}
        {items.map((it, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-white font-medium"
            style={{ background: color }}>
            {it}
            <button className="hover:opacity-70" onClick={() => onRemove(i)}><X size={10} strokeWidth={2.5} /></button>
          </span>
        ))}
      </div>
    </div>
  );
}

// Simplified tooltip for preview charts
function PreviewTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card px-2.5 py-1.5 shadow-lg text-xs">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex justify-between gap-3">
          <span className="text-muted-foreground">{p.name === "revenue" ? "Revenue" : p.name}</span>
          <span className="font-medium">{p.name === "revenue" ? fmtGBP(p.value) : fmtNum(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function CustomBuilder() {
  const [metrics, setMetrics] = useState(["Revenue", "Orders"]);
  const [dimensions, setDimensions] = useState(["Channel"]);
  const [filters, setFilters] = useState(["Date: Last 30 days"]);
  const [chartType, setChartType] = useState<ChartType>("bar");

  const add = (type: FieldType, name: string) => {
    if (type === "Metric"    && !metrics.includes(name))    setMetrics([...metrics, name]);
    if (type === "Dimension" && !dimensions.includes(name)) setDimensions([...dimensions, name]);
    if (type === "Filter"    && !filters.includes(name))    setFilters([...filters, name]);
  };
  const rm = (kind: "metrics" | "dimensions" | "filters") => (i: number) => {
    if (kind === "metrics")    setMetrics(s => s.filter((_, k) => k !== i));
    if (kind === "dimensions") setDimensions(s => s.filter((_, k) => k !== i));
    if (kind === "filters")    setFilters(s => s.filter((_, k) => k !== i));
  };

  const chartButtons: { id: ChartType; icon: LucideIcon; label: string }[] = [
    { id: "bar",   icon: BarChart2,        label: "Bar" },
    { id: "line",  icon: LineIcon,         label: "Line" },
    { id: "pie",   icon: PieIcon,          label: "Donut" },
    { id: "table", icon: Table2,           label: "Pivot" },
    { id: "kpi",   icon: Hash,             label: "KPI" },
  ];

  const barData = channels.map(c => ({ label: c.name.split(" ")[0], value: c.revenue, color: c.color }));

  return (
    <div className="grid gap-3.5" style={{ gridTemplateColumns: "256px 1fr" }}>
      {/* Field library */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <h3 className="text-sm font-semibold">Fields</h3>
        </CardHeader>
        <CardContent className="px-3 pb-4 space-y-4 overflow-y-auto max-h-[600px]">
          {(Object.entries(fieldLibrary) as [FieldType, string[]][]).map(([type, list]) => (
            <div key={type}>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5 px-1">{type}s</p>
              <div className="space-y-1">
                {list.map(f => <FieldChip key={f} name={f} type={type} onAdd={() => add(type, f)} />)}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Canvas */}
      <div className="space-y-3.5">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Slot label="Metrics"    items={metrics}    kind="metrics"    onRemove={rm("metrics")} />
              <Slot label="Dimensions" items={dimensions} kind="dimensions" onRemove={rm("dimensions")} />
              <Slot label="Filters"    items={filters}    kind="filters"    onRemove={rm("filters")} />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mr-1">Chart</span>
              {chartButtons.map(({ id, icon: Icon, label }) => (
                <Button key={id} size="sm" variant={chartType === id ? "default" : "outline"}
                  className="h-7 text-xs gap-1.5" onClick={() => setChartType(id)}>
                  <Icon size={12} /> {label}
                </Button>
              ))}
              <div className="flex-1" />
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"><Save size={12} /> Save</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"><Calendar size={12} /> Schedule</Button>
              <Button size="sm" className="h-7 text-xs gap-1.5"><Play size={12} /> Run</Button>
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Preview <span className="text-muted-foreground font-normal">
                  {metrics.join(", ") || "no metrics"} by {dimensions.join(", ") || "—"}
                </span>
              </h3>
              <div className="flex gap-1.5">
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"><Download size={12} /> CSV</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"><Download size={12} /> PDF</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"><Share2 size={12} /> Share</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {chartType === "bar" && (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={barData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={v => `£${Math.round(v/1000)}k`} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={42} />
                  <Tooltip content={<PreviewTooltip />} />
                  <Bar dataKey="value" name="revenue" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {barData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
            {chartType === "line" && (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={salesTrend} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} minTickGap={40} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={v => `£${Math.round(v/1000)}k`} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={42} />
                  <Tooltip content={<PreviewTooltip />} />
                  <Line type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
            {chartType === "pie" && (
              <div className="flex items-center justify-center py-4">
                <div className="relative" style={{ width: 200, height: 200 }}>
                  <PieChart width={200} height={200}>
                    <Pie data={channels.map(c => ({ name: c.name, value: c.revenue, color: c.color }))}
                      cx={100} cy={100} innerRadius={60} outerRadius={88} strokeWidth={0} paddingAngle={1.5} dataKey="value">
                      {channels.map((c, i) => <Cell key={i} fill={c.color} />)}
                    </Pie>
                  </PieChart>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                    <span className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">Revenue</span>
                    <span className="text-lg font-semibold tabular-nums">{fmtGBP(channels.reduce((s, c) => s + c.revenue, 0))}</span>
                  </div>
                </div>
                <div className="space-y-2 ml-6">
                  {channels.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="w-2 h-2 rounded-sm" style={{ background: c.color }} />
                      <span className="text-muted-foreground w-24 truncate">{c.name}</span>
                      <span className="font-medium tabular-nums">{fmtGBP(c.revenue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {chartType === "table" && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium text-muted-foreground">{dimensions[0] ?? "Dimension"}</th>
                    {metrics.map(m => <th key={m} className="py-2 text-right font-medium text-muted-foreground">{m}</th>)}
                    <th className="py-2 text-left font-medium text-muted-foreground pl-4">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((c, ci) => (
                    <tr key={c.key} className="border-b last:border-b-0 hover:bg-muted/40">
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-sm" style={{ background: c.color }} />
                          {c.name}
                        </div>
                      </td>
                      {metrics.map(m => (
                        <td key={m} className="py-2.5 text-right tabular-nums">
                          {m === "Revenue" ? fmtGBP(c.revenue) :
                           m === "Orders"  ? fmtNum(c.orders) :
                           m === "AOV"     ? fmtGBP(c.revenue / c.orders) :
                           m === "Units sold" ? fmtNum(Math.round(c.orders * 1.6)) :
                           m === "Sell-through %" ? (c.share / 4).toFixed(1) + "%" : "—"}
                        </td>
                      ))}
                      <td className="py-2.5 pl-4">
                        <div className="flex h-1.5 w-24 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${c.share}%`, background: c.color }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {chartType === "kpi" && (
              <div className="grid grid-cols-3 gap-3 pt-2">
                {metrics.map((m, i) => (
                  <div key={m} className="border-2 border-dashed rounded-lg p-4">
                    <p className="text-xs text-muted-foreground mb-1">{m}</p>
                    <p className="text-2xl font-semibold tabular-nums">
                      {i === 0 ? fmtGBP(403000) : i === 1 ? fmtNum(3829) : fmtGBP(105)}
                    </p>
                    <p className="text-xs text-emerald-600 mt-1">↑ {(8 + i * 3).toFixed(1)}% vs prev</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Saved reports tab ───────────────────────────────────────────────────────

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

function SavedReportsTab({ reports, isLoading, search, onSearch }: {
  reports: SavedReport[];
  isLoading: boolean;
  search: string;
  onSearch: (s: string) => void;
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
              {["Name","Template","Owner","Last updated","Schedule",""].map((h, i) => (
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
                            <button className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><Play size={13} /></button>
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

// ─── Scheduled tab ───────────────────────────────────────────────────────────

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

// ─── Page ────────────────────────────────────────────────────────────────────

const CATEGORIES = ["All","Sales","Inventory","Vendors","Customers","Marketing"];

export default function Reports() {
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [savedSearch, setSavedSearch] = useState("");

  const savedQ = useSavedReports(savedSearch);
  const scheduledQ = useReportSchedules();

  const filteredTemplates = categoryFilter === "All"
    ? reportTemplates
    : reportTemplates.filter(t => t.category === categoryFilter);

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

      <Tabs defaultValue="templates">
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

        <TabsContent value="templates" className="mt-4 space-y-4">
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
            {filteredTemplates.map(t => <TemplateCard key={t.id} tpl={t} />)}
          </div>
        </TabsContent>

        <TabsContent value="builder" className="mt-4">
          <CustomBuilder />
        </TabsContent>

        <TabsContent value="saved" className="mt-4">
          <SavedReportsTab
            reports={savedQ.data ?? []}
            isLoading={savedQ.isLoading}
            search={savedSearch}
            onSearch={setSavedSearch}
          />
        </TabsContent>

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
