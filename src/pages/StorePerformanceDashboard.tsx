import { useState, useMemo, useCallback } from "react";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
} from "recharts";
import {
  TrendingUp, TrendingDown, AlertTriangle, ShoppingCart,
  Boxes, Activity, Package, BarChart3, Lightbulb,
  ArrowUp, ArrowDown, Minus, Globe2, Layers, Zap,
  ChevronRight, ChevronLeft, RefreshCw, Loader2, CalendarDays, Download,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  type DateRangeKey, type DateBounds,
  getDateBounds, getCustomDateBounds, comparePeriodLabel,
} from "@/lib/dateRanges";
import {
  useStorePerformance,
  type StoreMetrics,
} from "@/hooks/useStorePerformance";
import {
  useInventoryDrillDown,
  fetchAllDrillDown,
  type DrillDownMetric,
  type DrillDownProduct,
} from "@/hooks/useInventoryDrillDown";
import {
  useStoreSalesPulse,
  type StoreSalesPulse,
  type ChannelSalesStat,
} from "@/hooks/useStoreSalesPulse";

// ─── Store accent colors (auto-assigned by index) ─────────────────────────────

const STORE_COLORS = [
  "#6366f1", // indigo
  "#f59e0b", // amber
  "#06b6d4", // cyan
  "#10b981", // emerald
  "#f43f5e", // rose
  "#a855f7", // purple
  "#3b82f6", // blue
  "#84cc16", // lime
];

function storeColor(idx: number): string {
  return STORE_COLORS[idx % STORE_COLORS.length];
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-GB");
}

function fmtC(value: number, sym: string, full = false): string {
  if (!full) {
    if (value >= 1_000_000) return `${sym}${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000)     return `${sym}${(value / 1_000).toFixed(1)}K`;
  }
  return `${sym}${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

// ─── Reusable atoms ───────────────────────────────────────────────────────────

function DeltaBadge({ value, inverse = false, suffix = "%" }: {
  value: number | null;
  inverse?: boolean;
  suffix?: string;
}) {
  if (value === null) return <span className="text-xs text-muted-foreground">—</span>;
  const positive = inverse ? value <= 0 : value >= 0;
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 text-xs font-medium",
      positive ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400",
    )}>
      {positive
        ? <ArrowUp size={9} strokeWidth={2.5} />
        : <ArrowDown size={9} strokeWidth={2.5} />}
      {Math.abs(value)}{suffix}
    </span>
  );
}

function ScoreRing({ score, color, size = 56 }: { score: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="hsl(var(--border))" strokeWidth={5} />
        <circle cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.6s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[15px] font-bold leading-none tabular-nums">{score}</span>
        <span className="text-[8px] text-muted-foreground leading-none mt-0.5">/ 100</span>
      </div>
    </div>
  );
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  const pts = data.map((v, i) => ({ i, v }));
  return (
    <AreaChart width={64} height={24} data={pts} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
      <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
        fill={color} fillOpacity={0.15} dot={false} isAnimationActive={false} />
    </AreaChart>
  );
}

function HealthBar({ value, className }: { value: number; className?: string }) {
  const color =
    value >= 75 ? "#10b981" :
    value >= 50 ? "#f59e0b" :
    "#ef4444";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-xs tabular-nums w-8 text-right font-medium" style={{ color }}>{value}</span>
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("bg-muted animate-pulse rounded", className)} />;
}

function InfoTooltip({ lines }: { lines: { label: string; desc: string }[] }) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-muted text-muted-foreground hover:bg-primary/15 hover:text-primary text-[9px] font-bold leading-none transition-colors shrink-0" aria-label="How is this calculated?">
            ?
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px] p-2.5 space-y-1.5 text-left">
          {lines.map(l => (
            <div key={l.label}>
              <p className="text-[10px] font-semibold text-foreground">{l.label}</p>
              <p className="text-[10px] text-muted-foreground leading-snug">{l.desc}</p>
            </div>
          ))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function ScoreBreakdownPopover({ m, color }: { m: StoreMetrics; color: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-transform hover:scale-105" aria-label="Show score breakdown">
          <ScoreRing score={m.performanceScore} color={color} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-64 p-3">
        <p className="text-xs font-semibold">Score breakdown — {m.storeName}</p>
        <p className="text-[10px] text-muted-foreground mb-2">Points earned per factor for the selected period.</p>
        <div className="space-y-1.5">
          {m.scoreBreakdown.map(f => (
            <div key={f.label}>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-muted-foreground truncate">
                  {f.label} <span className="text-foreground/80 tabular-nums">{f.value}</span>
                </span>
                <span className="font-semibold tabular-nums shrink-0">{f.points}/{f.max}</span>
              </div>
              <div className="h-1 bg-muted rounded-full overflow-hidden mt-0.5">
                <div className="h-full rounded-full" style={{ width: `${(f.points / f.max) * 100}%`, background: color }} />
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t mt-2.5 pt-2 text-xs font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{m.performanceScore}/100</span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">75+ Strong · 55–74 Average · below 55 At Risk</p>
      </PopoverContent>
    </Popover>
  );
}

// ─── Section: Page header + date range ────────────────────────────────────────

const RANGE_OPTS: { key: DateRangeKey; label: string }[] = [
  { key: "Today",  label: "Today" },
  { key: "WTD",    label: "7D" },
  { key: "MTD",    label: "MTD" },
  { key: "QTD",    label: "QTD" },
  { key: "YTD",    label: "YTD" },
];

export function DateRangePicker({ range, onRangeChange, customFrom, customTo, onCustomChange }: {
  range: DateRangeKey;
  onRangeChange: (r: DateRangeKey) => void;
  customFrom: Date | null;
  customTo: Date | null;
  onCustomChange: (from: Date, to: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  // Deliberately NOT seeded from customFrom/customTo. react-day-picker's range
  // mode treats a click against an already-complete range as extending it
  // (see addToRange: from+to both set -> new click becomes the new `to`,
  // keeping the old `from`) instead of starting fresh. So if we reopened with
  // the previous range pre-loaded, the very first click after reopening would
  // silently span old-date -> new-date instead of selecting just the new date.
  // Starting blank on every open means the first click always begins a new
  // single-day selection, and a second click is needed to extend it.
  const [sel, setSel] = useState<{ from: Date; to?: Date } | undefined>(undefined);
  const label = customFrom && customTo && range === "Custom"
    ? `${format(customFrom, "dd MMM")} – ${format(customTo, "dd MMM")}`
    : "Custom";

  return (
    <div className="flex items-center rounded-lg border overflow-hidden text-xs">
      {RANGE_OPTS.map(o => (
        <button key={o.key} onClick={() => onRangeChange(o.key)}
          className={cn(
            "px-2.5 py-1.5 font-medium transition-colors border-r last:border-r-0",
            range === o.key
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted text-muted-foreground",
          )}>
          {o.label}
        </button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            onClick={() => { setSel(undefined); onRangeChange("Custom"); }}
            className={cn(
              "px-2.5 py-1.5 font-medium transition-colors flex items-center gap-1 border-l",
              range === "Custom" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground",
            )}>
            {range === "Custom" && customFrom && <CalendarDays size={10} />}
            {label}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end" sideOffset={8}>
          <Calendar mode="range" selected={sel}
            onSelect={(r) => {
              setSel(r?.from ? { from: r.from, to: r.to } : undefined);
              if (r?.from && r?.to) { onCustomChange(r.from, r.to); setOpen(false); }
            }}
            numberOfMonths={2} disabled={{ after: new Date() }} initialFocus />
          {sel?.from && !sel?.to && (
            <p className="text-[11px] text-muted-foreground text-center pb-3">Click a second date to complete the range</p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─── Section: Global summary KPI cards ───────────────────────────────────────

function GlobalSummarySection({ bounds, range, data, loading }: {
  bounds: DateBounds;
  range: DateRangeKey;
  data: ReturnType<typeof useStorePerformance>["data"];
  loading: boolean;
}) {
  const g = data?.globalSummary;
  const label = comparePeriodLabel(range);

  const cards = [
    {
      label: "Total Revenue",
      value: g ? `£${fmtNum(g.totalRevenue)}` : "—",
      delta: g?.revenueDelta ?? null,
      sub: g ? `prev £${fmtNum(g.prevRevenue)} · ${label}` : label,
      icon: TrendingUp, color: "#6366f1", bg: "#eef2ff",
    },
    {
      label: "Total Orders",
      value: g ? fmtNum(g.totalOrders) : "—",
      delta: g?.ordersDelta ?? null,
      sub: g ? `prev ${fmtNum(g.prevOrders)} · ${label}` : label,
      icon: ShoppingCart, color: "#7c3aed", bg: "#ede9fe",
    },
    {
      label: "Total Units Sold",
      value: g ? fmtNum(g.totalUnitsSold) : "—",
      delta: null as number | null,
      sub: `${bounds.label}`,
      icon: Package, color: "#0891b2", bg: "#cffafe",
    },
    {
      label: "Avg Sell-Through",
      value: g ? `${g.avgSellThrough}%` : "—",
      delta: null as number | null,
      sub: "across all stores",
      icon: BarChart3, color: "#059669", bg: "#d1fae5",
    },
    {
      label: "Avg OOS Rate",
      value: g ? `${g.avgOOSRate}%` : "—",
      delta: null as number | null,
      sub: "of active SKUs",
      icon: Boxes,
      color: g && g.avgOOSRate >= 15 ? "#dc2626" : "#d97706",
      bg:    g && g.avgOOSRate >= 15 ? "#fee2e2" : "#fef3c7",
    },
    {
      label: "Avg Refund Rate",
      value: g ? `${g.avgRefundRate}%` : "—",
      delta: null as number | null,
      sub: "by orders",
      icon: Activity,
      color: g && g.avgRefundRate >= 5 ? "#dc2626" : "#6366f1",
      bg:    g && g.avgRefundRate >= 5 ? "#fee2e2" : "#eef2ff",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="p-4">
            <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
              <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                style={{ background: c.bg, color: c.color }}>
                <c.icon size={11} strokeWidth={2.2} />
              </span>
              {c.label}
            </div>
            {loading ? (
              <Skeleton className="h-7 w-24 mb-1.5" />
            ) : (
              <div className="text-[22px] font-bold tracking-tight tabular-nums leading-none">
                {c.value}
              </div>
            )}
            <div className="flex items-center gap-1.5 mt-1.5 text-xs min-h-[16px]">
              {c.delta !== null && !loading && <DeltaBadge value={c.delta} />}
              <span className="text-muted-foreground truncate text-[11px]">{c.sub}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Section: Store ranking ───────────────────────────────────────────────────

function StoreRankingSection({ metrics, loading }: {
  metrics: StoreMetrics[];
  loading: boolean;
}) {
  const ranked = useMemo(() =>
    [...metrics].sort((a, b) => b.performanceScore - a.performanceScore),
  [metrics]);

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <Globe2 size={14} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold">Store Ranking</h3>
          <span className="text-xs text-muted-foreground">Overall performance score · 0–100</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                {["Rank", "Store", "Score", "Score Change", "Revenue", "Orders", "OOS%", "Refund%", "Status"].map((h, i) => (
                  <th key={i} className={cn(
                    "px-4 py-2.5 font-medium text-muted-foreground text-left",
                    i > 1 && "text-right",
                    i === 0 && "w-14",
                  )}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className={cn("h-3", j === 1 ? "w-20" : "w-12")} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : ranked.map((m, idx) => {
                const color = storeColor(idx);
                const status =
                  m.performanceScore >= 75 ? { label: "Strong",   cls: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800" } :
                  m.performanceScore >= 55 ? { label: "Average",  cls: "text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800" } :
                                             { label: "At Risk",  cls: "text-red-700 bg-red-50 dark:bg-red-950/40 dark:text-red-300 border-red-200 dark:border-red-800" };
                return (
                  <tr key={m.storeId} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3">
                      <span className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs"
                        style={{ background: color + "22", color }}>
                        {idx + 1}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                        <span className="font-medium">{m.storeName}</span>
                        <span className="text-muted-foreground uppercase tracking-wide text-[10px]">{m.currency}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all"
                            style={{ width: `${m.performanceScore}%`, background: color }} />
                        </div>
                        <span className="font-bold tabular-nums w-7 text-right">{m.performanceScore}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <DeltaBadge value={m.scoreDelta} suffix="" />
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {fmtC(m.revenue, m.currencySymbol)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {fmtNum(m.orders)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={m.oosRate >= 15 ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}>
                        {fmtPct(m.oosRate)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={m.refundRate >= 5 ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}>
                        {fmtPct(m.refundRate)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", status.cls)}>
                        {status.label}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Section: Per-store performance cards ─────────────────────────────────────

function StoreCard({ m, idx }: { m: StoreMetrics; idx: number }) {
  const color = storeColor(idx);
  return (
    <Card className="overflow-hidden flex flex-col">
      {/* Card header band */}
      <div className="h-1.5 w-full" style={{ background: color }} />
      <CardContent className="p-4 flex-1 flex flex-col gap-3">

        {/* Store name + score ring */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: color }} />
              <h3 className="font-semibold text-sm">{m.storeName}</h3>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-mono">{m.currency}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <DeltaBadge value={m.revenueDelta} />
              <span className="text-[11px] text-muted-foreground">vs prev period</span>
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <ScoreBreakdownPopover m={m} color={color} />
            <InfoTooltip lines={[
              { label: "Performance Score (0–100)", desc: "Sum of points from 6 factors: Revenue growth 25 · Sell-through 20 · Refund rate 20 · OOS rate 15 · Order growth 10 · Dead stock 10. Click the ring for this store's full breakdown." },
              { label: "Score bands", desc: "75+ Strong · 55–74 Average · below 55 At Risk" },
            ]} />
          </div>
        </div>

        {/* Sparkline */}
        {m.dailyRevenue.length > 1 && (
          <MiniSparkline data={m.dailyRevenue} color={color} />
        )}

        {/* Primary metrics */}
        <div className="grid grid-cols-3 gap-2 pt-1 border-t">
          {[
            { label: "Revenue",   value: fmtC(m.revenue,   m.currencySymbol), sub: <DeltaBadge value={m.revenueDelta} /> },
            { label: "Orders",    value: fmtNum(m.orders),                    sub: <DeltaBadge value={m.ordersDelta} /> },
            { label: "Units",     value: fmtNum(m.unitsSold),                 sub: <span className="text-[10px] text-muted-foreground">sold</span> },
          ].map(k => (
            <div key={k.label}>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{k.label}</div>
              <div className="text-sm font-semibold tabular-nums">{k.value}</div>
              <div>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* Secondary metrics */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs border-t pt-2">
          {[
            { label: "AOV",          value: fmtC(m.aov, m.currencySymbol),       warn: false,              tooltip: null },
            { label: "Sell-through", value: `${m.sellThrough.toFixed(1)}%`,       warn: m.sellThrough < 20, tooltip: [
                { label: "Sell-through rate", desc: "Units sold ÷ (Units sold + Units currently in stock) × 100." },
                { label: "Benchmark", desc: "Below 20% = slow-moving stock. Above 60% = strong velocity." },
              ] },
            { label: "OOS",          value: `${m.oosRate.toFixed(1)}%`,           warn: m.oosRate >= 15,    tooltip: null },
            { label: "Refund rate",  value: `${m.refundRate.toFixed(1)}%`,         warn: m.refundRate >= 5,  tooltip: null },
          ].map(k => (
            <div key={k.label} className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-muted-foreground">
                {k.label}
                {k.tooltip && <InfoTooltip lines={k.tooltip} />}
              </span>
              <span className={cn("font-medium tabular-nums", k.warn && "text-red-600 dark:text-red-400")}>{k.value}</span>
            </div>
          ))}
        </div>

        {/* Inventory health bar */}
        <div className="border-t pt-2">
          <div className="flex items-center justify-between mb-1">
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase tracking-wide">
              Inventory health
              <InfoTooltip lines={[
                { label: "Inventory Health Score (0–100)", desc: "Starts at 100, minus penalties: OOS rate × 1.5 (max −40) · dead-stock share of active SKUs (max −30) · 2 pts per critically-low SKU (max −15)." },
                { label: "Colour guide", desc: "Green ≥75 · Amber ≥50 · Red <50" },
              ]} />
            </span>
            <span className="text-[10px] text-muted-foreground">{m.oosCount} OOS · {m.criticalCount} critical</span>
          </div>
          <HealthBar value={m.inventoryHealthScore} />
        </div>

        {/* AI Diagnosis */}
        <div className="rounded-lg bg-muted/60 border border-border/50 p-2.5 text-[11px] leading-relaxed text-muted-foreground flex gap-2">
          <Zap size={11} className="shrink-0 mt-0.5 text-amber-500" />
          <p>{m.diagnosis}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function StoreCardsSection({ metrics, loading }: {
  metrics: StoreMetrics[];
  loading: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-primary/10 text-primary">Stores</span>
        <h2 className="text-base font-semibold">Store Performance Cards</h2>
        <span className="text-xs text-muted-foreground">{loading ? "Loading…" : `${metrics.length} stores`}</span>
      </div>
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <div className="h-1.5 bg-muted animate-pulse" />
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-12 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {metrics.map((m, i) => <StoreCard key={m.storeId} m={m} idx={i} />)}
        </div>
      )}
    </div>
  );
}

// ─── Section: Sales Pulse (current vs previous period, all channels) ─────────

function ChannelSalesRow({ c, sym, fullNumbers }: { c: ChannelSalesStat; sym: string; fullNumbers: boolean }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.color }} />
      <span className="text-xs font-medium truncate flex-1 min-w-0">{c.name}</span>
      <span className="text-[11px] text-muted-foreground tabular-nums w-9 text-right shrink-0">{fmtNum(c.orders)}</span>
      <span className={cn("text-xs font-semibold tabular-nums text-right shrink-0", fullNumbers ? "w-24" : "w-20")}>{fmtC(c.revenue, sym, fullNumbers)}</span>
      <span className="w-11 text-right shrink-0">
        <DeltaBadge value={c.revenueDelta} />
      </span>
    </div>
  );
}

function delta(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

// Collapse a store's per-channel breakdown down to the selected channel(s),
// keeping the same shape so SalesPulseCard doesn't need to branch on filter state.
// Empty set = no filter = every channel.
function applyChannelFilter(p: StoreSalesPulse, selectedKeys: Set<string>): StoreSalesPulse {
  if (selectedKeys.size === 0) return p;
  const matched = p.channels.filter(ch => selectedKeys.has(ch.key));
  if (!matched.length) {
    return { ...p, revenue: 0, orders: 0, prevRevenue: 0, prevOrders: 0, revenueDelta: null, ordersDelta: null, channels: [] };
  }
  const revenue     = matched.reduce((s, c) => s + c.revenue, 0);
  const orders      = matched.reduce((s, c) => s + c.orders, 0);
  const prevRevenue = matched.reduce((s, c) => s + c.prevRevenue, 0);
  const prevOrders  = matched.reduce((s, c) => s + c.prevOrders, 0);
  return {
    ...p,
    revenue, orders, prevRevenue, prevOrders,
    revenueDelta: delta(revenue, prevRevenue),
    ordersDelta: delta(orders, prevOrders),
    channels: matched,
  };
}

function SalesPulseCard({ p, idx, channelFiltered, fullNumbers }: { p: StoreSalesPulse; idx: number; channelFiltered: boolean; fullNumbers: boolean }) {
  const color = storeColor(idx);
  return (
    <Card className="overflow-hidden flex flex-col">
      <div className="h-1.5 w-full" style={{ background: color }} />
      <CardContent className="p-4 flex-1 flex flex-col gap-3">

        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
          <h3 className="font-semibold text-sm">{p.storeName}</h3>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-mono">{p.currency}</span>
        </div>

        {/* Net sales + orders */}
        <div className="grid grid-cols-2 gap-3 pt-1 border-t">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Net Sales</div>
            <div className="text-lg font-bold tabular-nums leading-none">{fmtC(p.revenue, p.currencySymbol, fullNumbers)}</div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <DeltaBadge value={p.revenueDelta} />
              <span className="text-[10px] text-muted-foreground truncate">prev {fmtC(p.prevRevenue, p.currencySymbol, fullNumbers)}</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Orders</div>
            <div className="text-lg font-bold tabular-nums leading-none">{fmtNum(p.orders)}</div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <DeltaBadge value={p.ordersDelta} />
              <span className="text-[10px] text-muted-foreground truncate">prev {fmtNum(p.prevOrders)}</span>
            </div>
          </div>
        </div>

        {/* All channels — net sales & orders for the selected period */}
        {!channelFiltered && (
          <div className="border-t pt-2 flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">By channel</span>
              <span className="text-[10px] text-muted-foreground">{p.channels.length} active</span>
            </div>
            {!p.channels.length ? (
              <p className="text-[11px] text-muted-foreground py-3 text-center">No orders in this period.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto pr-1 -mr-1 divide-y divide-border/50">
                {p.channels.map(c => <ChannelSalesRow key={c.key} c={c} sym={p.currencySymbol} fullNumbers={fullNumbers} />)}
              </div>
            )}
          </div>
        )}
        {channelFiltered && !p.channels.length && (
          <p className="text-[11px] text-muted-foreground py-3 text-center border-t pt-3">No orders on this channel.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ChannelMultiSelect({ options, selected, onChange }: {
  options: { key: string; name: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(next);
  };
  const label = selected.size === 0
    ? "All channels"
    : selected.size === 1
      ? options.find(o => selected.has(o.key))?.name ?? "1 channel"
      : `${selected.size} channels`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs w-[150px] justify-between font-normal">
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[180px]">
        <DropdownMenuItem
          className="text-xs"
          onSelect={(e) => { e.preventDefault(); onChange(new Set()); }}
        >
          All channels
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {options.map(c => (
          <DropdownMenuCheckboxItem
            key={c.key}
            className="text-xs"
            checked={selected.has(c.key)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggle(c.key)}
          >
            {c.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SalesPulseSection({ pulse, loading, bounds, range, excludeShipping, onExcludeShippingChange }: {
  pulse: StoreSalesPulse[];
  loading: boolean;
  bounds: DateBounds;
  range: DateRangeKey;
  excludeShipping: boolean;
  onExcludeShippingChange: (value: boolean) => void;
}) {
  const [channelFilter, setChannelFilter] = useState<Set<string>>(new Set());
  const [fullNumbers, setFullNumbers] = useState(false);

  const channelOptions = useMemo(() => {
    const map = new Map<string, { key: string; name: string }>();
    for (const p of pulse) {
      for (const c of p.channels) {
        if (!map.has(c.key)) map.set(c.key, { key: c.key, name: c.name });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [pulse]);

  const filteredPulse = useMemo(
    () => pulse.map(p => applyChannelFilter(p, channelFilter)),
    [pulse, channelFilter],
  );

  return (
    <div>
      <div className="flex items-center gap-2.5 mb-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-500" />
          </span>
          Live
        </span>
        <h2 className="text-base font-semibold">Sales Pulse</h2>
        <span className="text-xs text-muted-foreground">Net sales &amp; full channel mix · {bounds.label} {comparePeriodLabel(range)}</span>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Switch
              id="exclude-shipping"
              checked={excludeShipping}
              onCheckedChange={onExcludeShippingChange}
              className="h-4 w-7 [&>span]:h-3 [&>span]:w-3"
            />
            <Label htmlFor="exclude-shipping" className="text-xs text-muted-foreground cursor-pointer">
              Exclude shipping
            </Label>
          </div>
          <div className="flex items-center gap-1.5">
            <Switch
              id="full-numbers"
              checked={fullNumbers}
              onCheckedChange={setFullNumbers}
              className="h-4 w-7 [&>span]:h-3 [&>span]:w-3"
            />
            <Label htmlFor="full-numbers" className="text-xs text-muted-foreground cursor-pointer">
              Full numbers
            </Label>
          </div>
          <ChannelMultiSelect options={channelOptions} selected={channelFilter} onChange={setChannelFilter} />
        </div>
      </div>
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <div className="h-1.5 bg-muted animate-pulse" />
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-36 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {filteredPulse.map((p, i) => (
            <SalesPulseCard key={p.storeId} p={p} idx={i} channelFiltered={channelFilter.size > 0} fullNumbers={fullNumbers} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Inventory drill-down modal ───────────────────────────────────────────────

const METRIC_LABELS: Record<DrillDownMetric, string> = {
  oos:         "Out of Stock Products",
  low_stock:   "Low Stock Products",
  critical:    "Critical Stock Products",
  dead_stock:  "Dead Stock Products",
  overstocked: "Overstocked Products",
};

function statusPill(status: string | null | undefined) {
  if (!status) return null;
  const cls: Record<string, string> = {
    "Critical":       "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    "Replenish Now":  "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400",
    "Low Stock":      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
    "Watch Closely":  "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400",
    "Out of Stock":   "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    "Never Sold":     "bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-400",
    "Dead 30d":       "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400",
    "Dead 60d":       "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
    "Dead 90d":       "bg-red-200 text-red-800 dark:bg-red-900/60 dark:text-red-300",
  };
  return (
    <span className={cn("inline-block px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap", cls[status] ?? "bg-muted text-muted-foreground")}>
      {status}
    </span>
  );
}

function toCsv(metric: DrillDownMetric, products: DrillDownProduct[]): string {
  const headers: Record<DrillDownMetric, string[]> = {
    oos:         ["Product Name", "SKU", "Collection", "Type"],
    low_stock:   ["Product Name", "SKU", "Available Units", "Velocity (units/wk)", "Days of Stock", "Status"],
    critical:    ["Product Name", "SKU", "Available Units", "Velocity (units/wk)", "Days of Stock", "Status"],
    dead_stock:  ["Product Name", "SKU", "Type", "Stock Units", "Last Sale", "Status", "Inventory Value"],
    overstocked: ["Product Name", "SKU", "Type", "Stock Units", "Unit Price", "Inventory Value"],
  };
  const rows = products.map(p => {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    if (metric === "oos")
      return [q(p.product_name), q(p.sku), q(p.collection_name), q(p.product_type)].join(",");
    if (metric === "low_stock" || metric === "critical")
      return [q(p.product_name), q(p.sku), q(p.available_units ?? 0), q(p.velocity ?? 0), q(p.days_of_stock ?? "N/A"), q(p.replenishment_status)].join(",");
    if (metric === "dead_stock")
      return [q(p.product_name), q(p.sku), q(p.product_type), q(p.total_units ?? 0), q(p.last_sale_at ? p.last_sale_at.slice(0, 10) : "Never"), q(p.dead_stock_status), q(Number(p.inventory_value ?? 0).toFixed(2))].join(",");
    // overstocked
    return [q(p.product_name), q(p.sku), q(p.product_type), q(p.total_units ?? 0), q(Number(p.unit_price ?? 0).toFixed(2)), q(Number(p.inventory_value ?? 0).toFixed(2))].join(",");
  });
  return [headers[metric].join(","), ...rows].join("\n");
}

function InventoryDrillDownModal({
  storeId, storeName, metric, onClose,
}: {
  storeId: string;
  storeName: string;
  metric: DrillDownMetric;
  onClose: () => void;
}) {
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);

  const { data, isLoading } = useInventoryDrillDown(storeId, metric, page, PAGE_SIZE);
  const products = data?.products ?? [];
  const total    = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const all = await fetchAllDrillDown(storeId, metric);
      const csv = toCsv(metric, all);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `${storeName.replace(/\s+/g, "_")}_${metric}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [storeId, storeName, metric]);

  // Column definitions per metric
  const isReplen = metric === "low_stock" || metric === "critical";
  const isDead   = metric === "dead_stock" || metric === "overstocked";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-full flex flex-col" style={{ maxHeight: "85vh" }}>
        <DialogHeader className="shrink-0">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <DialogTitle className="text-sm font-semibold">{storeName} — {METRIC_LABELS[metric]}</DialogTitle>
              {total > 0 && <p className="text-xs text-muted-foreground mt-0.5">{total.toLocaleString()} products total</p>}
            </div>
            <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting} className="shrink-0">
              {exporting
                ? <Loader2 size={13} className="animate-spin mr-1.5" />
                : <Download size={13} className="mr-1.5" />}
              Export CSV
            </Button>
          </div>
        </DialogHeader>

        {/* Table */}
        <div className="flex-1 overflow-auto min-h-0 rounded border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background z-10">
              <tr className="border-b">
                {metric === "oos" && <>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Product Name</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">SKU</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Collection</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Type</th>
                </>}
                {isReplen && <>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Product Name</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">SKU</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Available</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Vel (units/wk)</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Days of Stock</th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">Status</th>
                </>}
                {isDead && <>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Product Name</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">SKU</th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Type</th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Stock</th>
                  {metric === "dead_stock" && <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Last Sale</th>}
                  {metric === "overstocked" && <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Unit Price</th>}
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">Value</th>
                  {metric === "dead_stock" && <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">Status</th>}
                </>}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b last:border-0">
                      {Array.from({ length: metric === "oos" ? 4 : isReplen ? 6 : 6 }).map((_, j) => (
                        <td key={j} className="px-3 py-2.5">
                          <div className={cn("h-3 rounded bg-muted animate-pulse", j === 0 ? "w-48" : "w-16")} />
                        </td>
                      ))}
                    </tr>
                  ))
                : products.length === 0
                  ? <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No products found.</td></tr>
                  : products.map((p, i) => (
                      <tr key={p.product_id ?? i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        {metric === "oos" && <>
                          <td className="px-3 py-2.5 font-medium max-w-xs truncate">{p.product_name}</td>
                          <td className="px-3 py-2.5 text-muted-foreground font-mono">{p.sku ?? "—"}</td>
                          <td className="px-3 py-2.5 text-muted-foreground">{p.collection_name ?? "—"}</td>
                          <td className="px-3 py-2.5 text-muted-foreground">{p.product_type ?? "—"}</td>
                        </>}
                        {isReplen && <>
                          <td className="px-3 py-2.5 font-medium max-w-xs truncate">{p.product_name}</td>
                          <td className="px-3 py-2.5 text-muted-foreground font-mono">{p.sku ?? "—"}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{p.available_units ?? 0}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{p.velocity ?? 0}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
                            {p.days_of_stock != null ? <span className={p.days_of_stock < 7 ? "text-red-600 dark:text-red-400 font-medium" : ""}>{p.days_of_stock}d</span> : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-center">{statusPill(p.replenishment_status)}</td>
                        </>}
                        {isDead && <>
                          <td className="px-3 py-2.5 font-medium max-w-xs truncate">{p.product_name}</td>
                          <td className="px-3 py-2.5 text-muted-foreground font-mono">{p.sku ?? "—"}</td>
                          <td className="px-3 py-2.5 text-muted-foreground">{p.product_type ?? "—"}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{(p.total_units ?? 0).toLocaleString()}</td>
                          {metric === "dead_stock" && (
                            <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                              {p.last_sale_at ? p.last_sale_at.slice(0, 10) : <span className="text-slate-400">Never</span>}
                            </td>
                          )}
                          {metric === "overstocked" && (
                            <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                              {Number(p.unit_price ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          )}
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                            {Number(p.inventory_value ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          {metric === "dead_stock" && <td className="px-3 py-2.5 text-center">{statusPill(p.dead_stock_status)}</td>}
                        </>}
                      </tr>
                    ))
              }
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="shrink-0 flex items-center justify-between pt-2 text-xs text-muted-foreground">
            <span>
              Page {page + 1} of {totalPages} · {((page * PAGE_SIZE) + 1).toLocaleString()}–{Math.min((page + 1) * PAGE_SIZE, total).toLocaleString()} of {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage(0)} disabled={page === 0}>
                <ChevronLeft size={13} /><ChevronLeft size={13} className="-ml-2" />
              </Button>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage(p => p - 1)} disabled={page === 0}>
                <ChevronLeft size={13} />
              </Button>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>
                <ChevronRight size={13} />
              </Button>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>
                <ChevronRight size={13} /><ChevronRight size={13} className="-ml-2" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Section: Inventory health comparison ─────────────────────────────────────

function InventoryHealthSection({ metrics, loading }: {
  metrics: StoreMetrics[];
  loading: boolean;
}) {
  type DrillState = { storeId: string; storeName: string; metric: DrillDownMetric } | null;
  const [drill, setDrill] = useState<DrillState>(null);

  function openDrill(storeId: string, storeName: string, metric: DrillDownMetric, count: number) {
    if (count === 0) return;
    setDrill({ storeId, storeName, metric });
  }

  function DrillBtn({ count, cls, storeId, storeName, metric }: {
    count: number; cls: string; storeId: string; storeName: string; metric: DrillDownMetric;
  }) {
    if (count === 0) return <span className="text-muted-foreground">{fmtNum(count)}</span>;
    return (
      <button
        onClick={() => openDrill(storeId, storeName, metric, count)}
        className={cn("tabular-nums font-medium underline underline-offset-2 decoration-dashed hover:no-underline cursor-pointer transition-opacity hover:opacity-70", cls)}
      >
        {fmtNum(count)}
      </button>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center gap-2">
            <Boxes size={14} className="text-muted-foreground" />
            <h3 className="text-sm font-semibold">Inventory Health</h3>
            <span className="text-xs text-muted-foreground">Cross-store comparison · click a number to preview products</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  {([
                    { label: "Store", tip: null },
                    { label: "Health Score", tip: [
                      { label: "Inventory Health Score (0–100)", desc: "Starts at 100. Penalties: OOS rate × 1.5 (max −40) · dead-stock share of SKUs × 120 (max −30) · 2 pts per critically-low SKU (max −15)." },
                      { label: "Colours", desc: "Green ≥75 · Amber ≥50 · Red <50" },
                    ]},
                    { label: "Total SKUs", tip: [
                      { label: "Total SKUs", desc: "Count of active products synced to the database for this store." },
                    ]},
                    { label: "OOS", tip: [
                      { label: "Out of Stock", desc: "Active SKUs where total inventory = 0. Click the number to preview products." },
                    ]},
                    { label: "Low Stock", tip: [
                      { label: "Low Stock", desc: "Products with available units below 15 — candidates for replenishment soon. Click to preview." },
                    ]},
                    { label: "Critical", tip: [
                      { label: "Critical Stock", desc: "Products with ≤3 units available — high-urgency replenishment. Click to preview." },
                    ]},
                    { label: "Dead Stock", tip: [
                      { label: "Dead Stock", desc: "Active products with inventory in stock but zero sales in the last 30 days. Click to preview." },
                      { label: "Sub-categories", desc: "Dead 30d · Dead 60d · Dead 90d · Never Sold (no sale ever recorded)." },
                    ]},
                    { label: "Overstocked", tip: [
                      { label: "Overstocked", desc: "Never Sold products with 50+ units. Click to preview." },
                      { label: "Why it matters", desc: "Highest-priority clearance candidates — large quantities of completely untouched inventory tying up cash." },
                    ]},
                  ] as const).map((col, i) => (
                    <th key={i} className={cn("px-4 py-2.5 font-medium text-muted-foreground text-left", i > 0 && "text-right")}>
                      <span className={cn("inline-flex items-center gap-1", i > 0 && "justify-end")}>
                        {col.label}
                        {col.tip && <InfoTooltip lines={col.tip as { label: string; desc: string }[]} />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-b last:border-0">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-3 w-14" /></td>
                      ))}
                    </tr>
                  ))
                ) : metrics.map((m, idx) => {
                  const color = storeColor(idx);
                  return (
                    <tr key={m.storeId} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                          <span className="font-medium">{m.storeName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <HealthBar value={m.inventoryHealthScore} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmtNum(m.activeSKUs)}</td>
                      <td className="px-4 py-3 text-right">
                        <DrillBtn count={m.oosCount} cls="text-red-600 dark:text-red-400" storeId={m.storeId} storeName={m.storeName} metric="oos" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DrillBtn count={m.lowStockCount} cls="text-amber-600 dark:text-amber-400" storeId={m.storeId} storeName={m.storeName} metric="low_stock" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DrillBtn count={m.criticalCount} cls="text-red-600 dark:text-red-400" storeId={m.storeId} storeName={m.storeName} metric="critical" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DrillBtn count={m.deadStockCount} cls="text-amber-600 dark:text-amber-400" storeId={m.storeId} storeName={m.storeName} metric="dead_stock" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DrillBtn count={m.overstockedCount} cls="text-muted-foreground" storeId={m.storeId} storeName={m.storeName} metric="overstocked" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {drill && (
        <InventoryDrillDownModal
          storeId={drill.storeId}
          storeName={drill.storeName}
          metric={drill.metric}
          onClose={() => setDrill(null)}
        />
      )}
    </>
  );
}

// ─── Section: Opportunities ───────────────────────────────────────────────────

function OpportunitiesSection({
  opps, loading,
}: {
  opps: ReturnType<typeof useStorePerformance>["data"] extends infer T | undefined
    ? T extends { opportunities: infer O } ? O : never
    : never;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-emerald-600" />
          <h3 className="text-sm font-semibold">Top Opportunities</h3>
          <span className="text-xs text-muted-foreground">Auto-generated from live metrics</span>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="h-5 w-16 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : !opps?.length ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No significant opportunities detected in this period.</p>
        ) : (
          <div className="divide-y">
            {opps.map((o, i) => (
              <div key={i} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 mt-0.5 font-mono border-emerald-200 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800">
                  {o.storeCode.toUpperCase()}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium leading-snug">{o.opportunity}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{o.impact}</p>
                </div>
                <ChevronRight size={12} className="shrink-0 text-muted-foreground mt-0.5" />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section: Risks ───────────────────────────────────────────────────────────

function RisksSection({
  risks, loading,
}: {
  risks: ReturnType<typeof useStorePerformance>["data"] extends infer T | undefined
    ? T extends { risks: infer R } ? R : never
    : never;
  loading: boolean;
}) {
  const SEVERITY_STYLES = {
    high:   "border-red-200 text-red-700 bg-red-50 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800",
    medium: "border-amber-200 text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800",
    low:    "border-muted text-muted-foreground bg-muted/30",
  };

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} className="text-red-500" />
          <h3 className="text-sm font-semibold">Top Risks</h3>
          <span className="text-xs text-muted-foreground">Auto-generated from live metrics</span>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="h-5 w-16 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : !risks?.length ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No significant risks detected in this period.</p>
        ) : (
          <div className="divide-y">
            {risks.map((r, i) => (
              <div key={i} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <Badge variant="outline"
                  className={cn("text-[10px] px-1.5 py-0 shrink-0 mt-0.5 font-mono capitalize", SEVERITY_STYLES[r.severity])}>
                  {r.severity}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium leading-snug">
                    <span className="text-muted-foreground">{r.store} · </span>{r.risk}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{r.impact}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section: Category winners ────────────────────────────────────────────────

function CategoryWinnersSection({ metrics, loading }: {
  metrics: StoreMetrics[];
  loading: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">Categories</span>
        <h2 className="text-base font-semibold">Category Winners</h2>
        <span className="text-xs text-muted-foreground">Top 3 collections by revenue per store</span>
      </div>
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4 space-y-2">
              <Skeleton className="h-4 w-24" />
              {Array.from({ length: 3 }).map((_, j) => <Skeleton key={j} className="h-3 w-full" />)}
            </CardContent></Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {metrics.map((m, idx) => {
            const color = storeColor(idx);
            const maxRev = Math.max(...m.topCategories.map(c => c.revenue), 1);
            return (
              <Card key={m.storeId}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                    <span className="text-sm font-semibold">{m.storeName}</span>
                  </div>
                  {!m.topCategories.length ? (
                    <p className="text-xs text-muted-foreground">No collection data available.</p>
                  ) : (
                    <div className="space-y-3">
                      {m.topCategories.map((cat, i) => (
                        <div key={cat.name}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="font-medium truncate max-w-[120px]">{cat.name}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="tabular-nums text-muted-foreground">{fmtNum(cat.units)} units</span>
                              {cat.growth !== null && <DeltaBadge value={cat.growth} />}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                              <div className="h-full rounded-full"
                                style={{
                                  width: `${(cat.revenue / maxRev) * 100}%`,
                                  background: i === 0 ? color : color + "99",
                                }} />
                            </div>
                            <span className="text-xs font-medium tabular-nums w-14 text-right">
                              {fmtC(cat.revenue, m.currencySymbol)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Section: Cross-store trends chart ────────────────────────────────────────

const CHART_METRICS = [
  { key: "revenue" as const, label: "Revenue (units sold)" },
] as const;

function CrossStoreTrendsSection({ data, metrics, loading }: {
  data: ReturnType<typeof useStorePerformance>["data"];
  metrics: StoreMetrics[];
  loading: boolean;
}) {
  const trendData = data?.crossStoreTrend ?? [];

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Layers size={14} className="text-muted-foreground" />
            <h3 className="text-sm font-semibold">Cross-Store Trends</h3>
            <span className="text-xs text-muted-foreground">Daily units sold by store</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {metrics.map((m, i) => (
              <div key={m.storeId} className="flex items-center gap-1.5 text-xs">
                <span className="w-3 h-0.5 rounded" style={{ background: storeColor(i) }} />
                <span className="text-muted-foreground">{m.storeName}</span>
              </div>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-3">
        {loading ? (
          <div className="h-[220px] flex items-end gap-1 px-4">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="flex-1 bg-muted animate-pulse rounded-t"
                style={{ height: `${30 + Math.sin(i) * 20 + 20}%` }} />
            ))}
          </div>
        ) : !trendData.length ? (
          <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
            No trend data for this period.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                minTickGap={32} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false} tickLine={false} width={36}
                tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
              <RechartsTooltip
                contentStyle={{ fontSize: 11, borderRadius: 8 }}
                formatter={(v: number, name: string) => [fmtNum(v), name]}
              />
              {metrics.map((m, i) => (
                <Line key={m.storeCode} type="monotone" dataKey={m.storeCode}
                  name={m.storeName} stroke={storeColor(i)} strokeWidth={2}
                  dot={false} isAnimationActive={false}
                  connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section: AI Weekly Insights ──────────────────────────────────────────────

function AIInsightsSection({ insights, loading }: {
  insights: string[];
  loading: boolean;
}) {
  return (
    <Card className="border-amber-200/50 dark:border-amber-800/50 bg-gradient-to-br from-amber-50/30 to-card dark:from-amber-950/10">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <Lightbulb size={14} className="text-amber-500" />
          <h3 className="text-sm font-semibold">AI Weekly Insights</h3>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-200 text-amber-700 dark:border-amber-700 dark:text-amber-400">
            Data-driven
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-3 w-full" />)}
          </div>
        ) : !insights.length ? (
          <p className="text-xs text-muted-foreground">Insights will appear once store data is synced.</p>
        ) : (
          <ul className="space-y-2.5">
            {insights.map((insight, i) => (
              <li key={i} className="flex items-start gap-2.5 text-xs leading-relaxed">
                <span className="mt-0.5 w-4 h-4 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400
                  flex items-center justify-center text-[10px] font-bold shrink-0">
                  {i + 1}
                </span>
                <span className="text-foreground/80">{insight}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function StorePerformanceDashboard() {
  const [range, setRange] = useState<DateRangeKey>("MTD");
  const [customFrom, setCustomFrom] = useState<Date | null>(null);
  const [customTo,   setCustomTo]   = useState<Date | null>(null);
  const [excludeShipping, setExcludeShipping] = useState(false);

  const bounds = useMemo<DateBounds>(() => {
    if (range === "Custom" && customFrom && customTo) {
      return getCustomDateBounds(customFrom, customTo);
    }
    return getDateBounds(range);
  }, [range, customFrom, customTo]);

  const { data, isLoading, isFetching, refetch } = useStorePerformance(bounds);
  const {
    data: pulseData, isLoading: pulseLoading, isFetching: pulseFetching, refetch: refetchPulse,
  } = useStoreSalesPulse(bounds, excludeShipping);
  const queryClient = useQueryClient();

  const metrics    = data?.storeMetrics     ?? [];
  const opps       = data?.opportunities    ?? [];
  const risks      = data?.risks            ?? [];
  const insights   = data?.insights         ?? [];

  const rankedMetrics = useMemo(
    () => [...metrics].sort((a, b) => b.performanceScore - a.performanceScore),
    [metrics],
  );

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6 max-w-[1800px] mx-auto">

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Globe2 size={18} className="text-primary" />
            <h1 className="text-xl font-bold tracking-tight">Store Performance Dashboard</h1>
            {(isFetching || pulseFetching) && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
          </div>
          <p className="text-sm text-muted-foreground">
            Cross-store operational and inventory performance · <span className="font-medium">{bounds.label}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <DateRangePicker
            range={range}
            onRangeChange={setRange}
            customFrom={customFrom}
            customTo={customTo}
            onCustomChange={(f, t) => { setCustomFrom(f); setCustomTo(t); }}
          />
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5"
            onClick={() => { refetch(); refetchPulse(); }} disabled={isFetching || pulseFetching}>
            {(isFetching || pulseFetching)
              ? <Loader2 size={12} className="animate-spin" />
              : <RefreshCw size={12} />}
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Sales Pulse: net sales + full channel mix, follows the date filter ── */}
      <section>
        <SalesPulseSection
          pulse={pulseData ?? []}
          loading={pulseLoading}
          bounds={bounds}
          range={range}
          excludeShipping={excludeShipping}
          onExcludeShippingChange={setExcludeShipping}
        />
      </section>

      {/* ── Store performance cards (top) ────────────────────────────────────── */}
      <section>
        <StoreCardsSection metrics={metrics} loading={isLoading} />
      </section>

      {/* ── Store ranking ────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400">Ranking</span>
          <h2 className="text-base font-semibold">Store Ranking</h2>
        </div>
        <StoreRankingSection metrics={rankedMetrics} loading={isLoading} />
      </section>

      {/* ── Section 5: Inventory health ───────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Inventory</span>
          <h2 className="text-base font-semibold">Inventory Health</h2>
        </div>
        <InventoryHealthSection metrics={rankedMetrics} loading={isLoading} />
      </section>

      {/* ── Section 6+7: Opportunities + Risks (side by side) ────────────────── */}
      <section>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Opportunities</span>
              <h2 className="text-base font-semibold">Top Opportunities</h2>
            </div>
            <OpportunitiesSection opps={opps as any} loading={isLoading} />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-red-500/10 text-red-600 dark:text-red-400">Risks</span>
              <h2 className="text-base font-semibold">Top Risks</h2>
            </div>
            <RisksSection risks={risks as any} loading={isLoading} />
          </div>
        </div>
      </section>

      {/* ── Section 8: Category winners ───────────────────────────────────────── */}
      <section>
        <CategoryWinnersSection metrics={metrics} loading={isLoading} />
      </section>

      {/* ── Section 9: Cross-store trends ─────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">Trends</span>
          <h2 className="text-base font-semibold">Cross-Store Trends</h2>
        </div>
        <CrossStoreTrendsSection data={data} metrics={metrics} loading={isLoading} />
      </section>

      {/* ── Section 10: AI Weekly Insights ────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">AI</span>
          <h2 className="text-base font-semibold">AI Weekly Insights</h2>
        </div>
        <AIInsightsSection insights={insights} loading={isLoading} />
      </section>

    </div>
  );
}
