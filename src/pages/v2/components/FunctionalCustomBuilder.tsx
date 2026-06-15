import { useState } from "react";
import {
  BarChart2, Clock, Save, Play, Calendar, Download, Share2,
  GripVertical, X, ChevronRight, Hash, AlertCircle, Loader2,
} from "lucide-react";
import {
  PieChart as PieIcon, LineChart as LineIcon,
  Table2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line, PieChart, Pie, Cell,
} from "recharts";
import { toast } from "sonner";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCustomReport } from "../lib/useReportData";
import { useCurrency } from "@/hooks/useCurrency";
import { useRole } from "@/hooks/useRole";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import { RangePicker } from "./ReportPanels";
import { downloadCsv, csvName, type CsvColumn } from "../lib/exportReport";
import SaveReportDialog from "./SaveReportDialog";
import ScheduleDialog from "./ScheduleDialog";
import type { DateRange } from "../lib/reportsEngine";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  Metric:    ["Revenue", "Orders", "AOV", "Units sold"],
  Dimension: ["Channel", "Collection", "Day", "Week", "Month", "SKU", "Vendor"],
  Filter:    ["Date range", "Status", "Channel"],
};

const PIE_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

const fmtN = (n: number) => new Intl.NumberFormat("en-GB").format(Math.round(n));

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldChip({ name, type, onAdd }: { name: string; type: FieldType; onAdd: () => void }) {
  return (
    <button onClick={onAdd}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border bg-card hover:bg-muted text-xs transition-colors text-left w-full">
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

function ResultTooltip({ active, payload, label }: any) {
  const { fmtCurrencyInt: fmt } = useCurrency();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-lg text-xs space-y-1">
      <p className="font-medium text-muted-foreground">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{p.name}</span>
          <span className="font-semibold">
            {["Revenue", "AOV"].includes(p.name) ? fmt(p.value) : fmtN(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FunctionalCustomBuilder() {
  const { fmtCurrencyInt: fmt, symbol } = useCurrency();
  const { canEdit } = useRole();
  const { storeId } = useStoreFilter();
  const [metrics, setMetrics] = useState<string[]>(["Revenue", "Orders"]);
  const [dimensions, setDimensions] = useState<string[]>(["Channel"]);
  const [filters, setFilters] = useState<string[]>(["Date range"]);
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [saveOpen, setSaveOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const { data, isLoading, error, lastConfig, run } = useCustomReport();

  const add = (type: FieldType, name: string) => {
    if (type === "Metric"    && !metrics.includes(name))    setMetrics(s => [...s, name]);
    if (type === "Dimension" && !dimensions.includes(name)) setDimensions(s => [...s, name]);
    if (type === "Filter"    && !filters.includes(name))    setFilters(s => [...s, name]);
  };
  const rm = (kind: "metrics" | "dimensions" | "filters") => (i: number) => {
    if (kind === "metrics")    setMetrics(s => s.filter((_, k) => k !== i));
    if (kind === "dimensions") setDimensions(s => s.filter((_, k) => k !== i));
    if (kind === "filters")    setFilters(s => s.filter((_, k) => k !== i));
  };

  const handleRun = () => run({ metrics, dimensions, filters, dateRange });

  const chartButtons: { id: ChartType; icon: LucideIcon; label: string }[] = [
    { id: "bar",   icon: BarChart2,  label: "Bar" },
    { id: "line",  icon: LineIcon,   label: "Line" },
    { id: "pie",   icon: PieIcon,    label: "Donut" },
    { id: "table", icon: Table2,     label: "Pivot" },
    { id: "kpi",   icon: Hash,       label: "KPI" },
  ];

  // Shape data for charts — primary metric is metrics[0]
  const primaryMetric = metrics[0] ?? "Revenue";
  const chartData = data?.map(row => ({
    label: String(row.label),
    ...Object.fromEntries(metrics.map(m => [m, Number(row[m] ?? 0)])),
  })) ?? [];

  const isCurrency = ["Revenue", "AOV"].includes(primaryMetric);
  const tickFmt = isCurrency
    ? (v: number) => `${symbol}${Math.round(v / 1000)}k`
    : (v: number) => fmtN(v);

  // Config persisted with a saved custom report (lets it re-run later).
  const builderConfig = { metrics, dimensions, filters, dateRange, chartType };

  const csvColumns = (): CsvColumn<typeof chartData[number]>[] => [
    { key: "label", header: dimensions[0] ?? "Dimension" },
    ...metrics.map(m => ({
      key: m,
      header: m,
      map: (row: any) => Number(row[m] ?? 0),
    })),
  ];

  const handleCsv = () => {
    if (!chartData.length) return;
    downloadCsv(csvName("custom-report"), csvColumns(), chartData);
  };

  const handleCopy = async () => {
    if (!chartData.length) return;
    const cols = csvColumns();
    const tsv = [
      cols.map(c => c.header).join("\t"),
      ...chartData.map(row => cols.map(c => (c.map ? c.map(row) : (row as any)[c.key])).join("\t")),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(tsv);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

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
            {/* Date range */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mr-1">Period</span>
              <RangePicker value={dateRange} onChange={setDateRange} />
            </div>

            {/* Slots */}
            <div className="grid grid-cols-3 gap-3">
              <Slot label="Metrics"    items={metrics}    kind="metrics"    onRemove={rm("metrics")} />
              <Slot label="Dimensions" items={dimensions} kind="dimensions" onRemove={rm("dimensions")} />
              <Slot label="Filters"    items={filters}    kind="filters"    onRemove={rm("filters")} />
            </div>

            {/* Chart type + actions */}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mr-1">Chart</span>
              {chartButtons.map(({ id, icon: Icon, label }) => (
                <Button key={id} size="sm" variant={chartType === id ? "default" : "outline"}
                  className="h-7 text-xs gap-1.5" onClick={() => setChartType(id)}>
                  <Icon size={12} /> {label}
                </Button>
              ))}
              <div className="flex-1" />
              {canEdit && (
                <>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => setSaveOpen(true)}><Save size={12} /> Save</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => setScheduleOpen(true)}><Calendar size={12} /> Schedule</Button>
                </>
              )}
              <Button size="sm" className="h-7 text-xs gap-1.5" onClick={handleRun} disabled={isLoading}>
                {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                {isLoading ? "Running…" : "Run"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {data
                  ? <span>{lastConfig?.metrics.join(", ") || "—"} by {lastConfig?.dimensions.join(", ") || "—"}</span>
                  : <span className="text-muted-foreground font-normal">Configure fields above and click Run</span>}
              </h3>
              {data && chartData.length > 0 && (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={handleCsv}><Download size={12} /> CSV</Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={handleCopy}><Share2 size={12} /> Copy</Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive py-4">
                <AlertCircle size={15} />
                {error}
              </div>
            )}

            {/* Loading */}
            {isLoading && (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 size={16} className="animate-spin" />
                Querying Supabase…
              </div>
            )}

            {/* Empty / prompt */}
            {!isLoading && !error && !data && (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-sm text-muted-foreground">
                <BarChart2 size={20} className="opacity-40" />
                <p>Select metrics + dimensions, then click Run to query your live data.</p>
              </div>
            )}

            {/* Results */}
            {!isLoading && !error && data && chartData.length > 0 && (
              <>
                {chartType === "bar" && (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={tickFmt} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={46} />
                      <Tooltip content={<ResultTooltip />} />
                      {metrics.map((m, i) => (
                        <Bar key={m} dataKey={m} name={m} fill={PIE_COLORS[i % PIE_COLORS.length]}
                          radius={[3, 3, 0, 0]} isAnimationActive={false} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                )}

                {chartType === "line" && (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} minTickGap={40} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={tickFmt} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={46} />
                      <Tooltip content={<ResultTooltip />} />
                      {metrics.map((m, i) => (
                        <Line key={m} type="monotone" dataKey={m} name={m}
                          stroke={PIE_COLORS[i % PIE_COLORS.length]} strokeWidth={2} dot={false} isAnimationActive={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}

                {chartType === "pie" && (
                  <div className="flex items-center justify-center py-4 gap-8">
                    <PieChart width={200} height={200}>
                      <Pie data={chartData.map((d, i) => ({ name: d.label, value: d[primaryMetric] as number, color: PIE_COLORS[i % PIE_COLORS.length] }))}
                        cx={100} cy={100} innerRadius={60} outerRadius={88} strokeWidth={0} paddingAngle={1.5} dataKey="value">
                        {chartData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                    </PieChart>
                    <div className="space-y-2">
                      {chartData.slice(0, 8).map((d, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                          <span className="text-muted-foreground truncate max-w-[120px]">{d.label}</span>
                          <span className="font-medium tabular-nums ml-auto">
                            {isCurrency ? fmt(d[primaryMetric] as number) : fmtN(d[primaryMetric] as number)}
                          </span>
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
                      </tr>
                    </thead>
                    <tbody>
                      {chartData.map((row, i) => (
                        <tr key={i} className="border-b last:border-b-0 hover:bg-muted/40">
                          <td className="py-2.5 font-medium">{row.label}</td>
                          {metrics.map(m => (
                            <td key={m} className="py-2.5 text-right tabular-nums">
                              {["Revenue", "AOV"].includes(m) ? fmt(row[m] as number) : fmtN(row[m] as number)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {chartType === "kpi" && (
                  <div className="grid grid-cols-3 gap-3 pt-2">
                    {metrics.map((m, i) => {
                      const total = chartData.reduce((s, r) => s + (Number(r[m]) || 0), 0);
                      return (
                        <div key={m} className="border-2 border-dashed rounded-lg p-4">
                          <p className="text-xs text-muted-foreground mb-1">{m} (total)</p>
                          <p className="text-2xl font-semibold tabular-nums">
                            {["Revenue", "AOV"].includes(m) ? fmt(total) : fmtN(total)}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">{chartData.length} {dimensions[0] ?? "rows"}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {!isLoading && !error && data && chartData.length === 0 && (
              <p className="text-sm text-muted-foreground py-8 text-center">No data returned for this configuration.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <SaveReportDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        defaultTemplateName="Custom"
        defaultConfig={builderConfig}
        storeId={storeId}
      />
      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        storeId={storeId}
      />
    </div>
  );
}
