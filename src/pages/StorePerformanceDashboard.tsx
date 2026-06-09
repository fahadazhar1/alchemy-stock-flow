import { useState, useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
} from "recharts";
import {
  TrendingUp, TrendingDown, AlertTriangle, ShoppingCart,
  Boxes, Activity, Package, BarChart3, Lightbulb,
  ArrowUp, ArrowDown, Minus, Globe2, Layers, Zap,
  ChevronRight, RefreshCw, Loader2, CalendarDays,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

function fmtC(value: number, sym: string): string {
  if (value >= 1_000_000) return `${sym}${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000)     return `${sym}${(value / 1_000).toFixed(1)}K`;
  return `${sym}${Math.round(value).toLocaleString("en-GB")}`;
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

// ─── Section: Page header + date range ────────────────────────────────────────

const RANGE_OPTS: { key: DateRangeKey; label: string }[] = [
  { key: "Today",  label: "Today" },
  { key: "WTD",    label: "7D" },
  { key: "MTD",    label: "MTD" },
  { key: "QTD",    label: "QTD" },
  { key: "YTD",    label: "YTD" },
];

function DateRangePicker({ range, onRangeChange, customFrom, customTo, onCustomChange }: {
  range: DateRangeKey;
  onRangeChange: (r: DateRangeKey) => void;
  customFrom: Date | null;
  customTo: Date | null;
  onCustomChange: (from: Date, to: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<{ from: Date; to?: Date } | undefined>(
    customFrom && customTo ? { from: customFrom, to: customTo } : undefined,
  );
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
            onClick={() => { setSel(customFrom && customTo ? { from: customFrom, to: customTo } : undefined); onRangeChange("Custom"); }}
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
                        <Skeleton className="h-3" style={{ width: j === 1 ? "80px" : "48px" }} />
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
            <ScoreRing score={m.performanceScore} color={color} />
            <InfoTooltip lines={[
              { label: "Performance Score (0–100)", desc: "Weighted composite: Revenue trend 30%, Order volume 20%, OOS rate 20%, Inventory health 20%, Refund rate 10%." },
              { label: "Score bands", desc: "80–100 Excellent · 60–79 Good · 40–59 Fair · 0–39 Needs attention" },
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
                { label: "Inventory Health Score (0–100)", desc: "100 minus penalties: each OOS SKU −0.5 pts, each critical (≤3 units) SKU −1 pt, dead-stock SKUs −0.2 pts." },
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

// ─── Section: Inventory health comparison ─────────────────────────────────────

function InventoryHealthSection({ metrics, loading }: {
  metrics: StoreMetrics[];
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <Boxes size={14} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold">Inventory Health</h3>
          <span className="text-xs text-muted-foreground">Cross-store comparison</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                {["Store", "Health Score", "Total SKUs", "OOS", "Low Stock", "Critical", "Dead Stock", "Overstocked"].map((h, i) => (
                  <th key={i} className={cn("px-4 py-2.5 font-medium text-muted-foreground text-left", i > 0 && "text-right")}>{h}</th>
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
                    <td className="px-4 py-3 text-right tabular-nums">{fmtNum(m.activeSKUs)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={m.oosCount > 0 ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}>
                        {fmtNum(m.oosCount)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={m.lowStockCount > 5 ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground"}>
                        {fmtNum(m.lowStockCount)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={m.criticalCount > 0 ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}>
                        {fmtNum(m.criticalCount)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={m.deadStockCount > 10 ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground"}>
                        {fmtNum(m.deadStockCount)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {fmtNum(m.overstockedCount)}
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

  const bounds = useMemo<DateBounds>(() => {
    if (range === "Custom" && customFrom && customTo) {
      return getCustomDateBounds(customFrom, customTo);
    }
    return getDateBounds(range);
  }, [range, customFrom, customTo]);

  const { data, isLoading, isFetching, refetch } = useStorePerformance(bounds);
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
            {isFetching && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
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
            onClick={() => refetch()} disabled={isFetching}>
            {isFetching
              ? <Loader2 size={12} className="animate-spin" />
              : <RefreshCw size={12} />}
            Refresh
          </Button>
        </div>
      </div>

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
