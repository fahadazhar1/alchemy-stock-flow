import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ResponsiveContainer, ComposedChart, AreaChart, Area, Line,
  BarChart, Bar, PieChart, Pie, Cell,
  ScatterChart, Scatter, ZAxis, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import {
  Banknote, ShoppingCart, CreditCard, TrendingUp, Activity,
  Boxes, XCircle, Award, TrendingDown, AlertTriangle, Download,
  RefreshCw, MoreHorizontal, Warehouse, Truck, Package,
  Clock, Layers, ArrowUp, ArrowDown, ChevronRight, Eye, X,
  CheckSquare, Loader2, ReceiptText, CalendarDays,
  Users, Repeat2, Target, Tag, Globe,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { fmtNum } from "./mockData";
import { useCurrency } from "@/hooks/useCurrency";
import { useTopProducts } from "@/hooks/useTopProducts";
import { useSalesTrend } from "@/hooks/useSalesTrend";
import { useChannelPerformance } from "@/hooks/useChannelPerformance";
import { useInventoryDashboard } from "@/hooks/useInventoryDashboard";
import { OutOfStockWidget } from "./components/OutOfStockWidget";
import { TopProductsModal } from "./components/TopProductsModal";
import { DeadstockLosersModal } from "./components/DeadstockLosersModal";
import { useDeadstockPreview, useDeadstockSummary, getDeadstockLabel } from "@/hooks/useDeadstockPreview";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { parseISO } from "date-fns";
import { useSalesKPIs, useCollectionSales, useCustomerMetrics, useFulfillmentMetrics, useDiscountUsage, useTrafficSources, useChannelConversion, useCheckoutAbandonment, useUTMCampaigns } from "@/hooks/useSalesKPIs";
import { useBundleSales } from "@/hooks/useBundleSales";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/contexts/StoreContext";
import { type DateRangeKey, type DateBounds, getDateBounds, getCustomDateBounds, comparePeriodLabel } from "@/lib/dateRanges";

// ─── Sparkline ───────────────────────────────────────────────────────────────

function Sparkline({ data, color = "#6366f1" }: { data: number[]; color?: string }) {
  const d = data.map((v, i) => ({ i, v }));
  return (
    <AreaChart width={70} height={26} data={d} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
      <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
        fill={color} fillOpacity={0.2} dot={false} isAnimationActive={false} />
    </AreaChart>
  );
}

// ─── KPI card ────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string; value: string | number; unit?: string;
  delta?: number; deltaUp?: boolean; deltaLabel?: string; footer?: string;
  prevValue?: string;
  icon?: LucideIcon; iconColor?: string; iconBg?: string;
  sparkData?: number[]; sparkColor?: string;
  progress?: number; progressColor?: string;
  onClick?: () => void;
}

function KpiCard({ label, value, unit, delta, deltaUp, deltaLabel, footer, prevValue,
  icon: Icon, iconColor, iconBg, sparkData, sparkColor, progress, progressColor, onClick }: KpiCardProps) {
  return (
    <Card className={cn("relative overflow-hidden", onClick && "cursor-pointer")} onClick={onClick}>
      <CardContent className="p-4 pb-3">
        <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
          {Icon && (
            <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
              style={{ background: iconBg, color: iconColor }}>
              <Icon size={11} strokeWidth={2.2} />
            </span>
          )}
          {label}
        </div>
        <div className="text-[22px] font-bold tracking-tight tabular-nums leading-none">
          {value}{unit && <span className="text-sm font-normal text-muted-foreground ml-0.5">{unit}</span>}
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 text-xs min-h-[16px]">
          {delta != null && (
            <span className={cn("flex items-center gap-0.5 font-medium",
              deltaUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400")}>
              {deltaUp ? <ArrowUp size={10} strokeWidth={2.5} /> : <ArrowDown size={10} strokeWidth={2.5} />}
              {Math.abs(delta)}%
            </span>
          )}
          {(deltaLabel || footer) && (
            <span className="text-muted-foreground truncate">{deltaLabel ?? footer}</span>
          )}
        </div>
        {prevValue && (
          <div className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">
            {prevValue}
          </div>
        )}
        {progress != null && (
          <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: progressColor }} />
          </div>
        )}
        {sparkData && (
          <div className="mt-2 -mb-1">
            <Sparkline data={sparkData} color={sparkColor} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Donut chart ─────────────────────────────────────────────────────────────

interface DonutItem { name: string; value: number; color: string; formatted?: string; orders?: number }

function DonutChart({ data, centerLabel, centerValue, size = 140, showLegend = true }:
  { data: DonutItem[]; centerLabel: string; centerValue: string; size?: number; showLegend?: boolean }) {
  const r = size / 2;
  const outer = Math.round(r * 0.83);
  const inner = Math.round(r * 0.54);
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <PieChart width={size} height={size}>
          <Pie data={data} cx={r} cy={r} innerRadius={inner} outerRadius={outer}
            strokeWidth={0} paddingAngle={1.5} dataKey="value">
            {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
          </Pie>
        </PieChart>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <span className="text-[8.5px] uppercase tracking-wider font-semibold text-muted-foreground leading-none">
            {centerLabel}
          </span>
          <span className="text-base font-semibold mt-0.5 tabular-nums leading-none">{centerValue}</span>
        </div>
      </div>
      {showLegend && (
        <div className="flex-1 min-w-0 space-y-1.5">
          {data.map((d, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: d.color }} />
              <span className="flex-1 truncate text-muted-foreground">{d.name}</span>
              <span className="tabular-nums text-right">
                <span className="font-medium">{d.formatted ?? d.value.toLocaleString()}</span>
                {d.orders != null && (
                  <span className="block text-[10px] text-muted-foreground leading-tight">
                    {d.orders.toLocaleString()} {d.orders === 1 ? "order" : "orders"}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Trend chart tooltip ─────────────────────────────────────────────────────

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  const { fmtCurrency: fmtGBP } = useCurrency();
  if (!active || !payload?.length) return null;
  const isProjected = payload[0]?.payload?.isProjected === true;
  const labelMap: Record<string, string> = {
    revenue:     "Revenue",
    orders:      "Orders",
    prevRevenue: "Prev Revenue",
    prevOrders:  "Prev Orders",
    projected:   "Projected (run rate)",
  };
  const toShow = isProjected
    ? payload.filter((p: any) => p.name === "projected")
    : payload.filter((p: any) => p.name !== "projected");
  return (
    <div className="rounded-lg border bg-card p-2.5 shadow-lg text-xs min-w-[160px]">
      <p className="font-semibold mb-1.5">
        {label}
        {isProjected && <span className="text-amber-500 ml-1.5 font-normal">· forecast</span>}
      </p>
      {toShow.map((p: any, i: number) => (
        <div key={i} className="flex justify-between gap-4">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm inline-block" style={{ background: p.color }} />
            {labelMap[p.name] ?? p.name}
          </span>
          <span className="font-medium tabular-nums">
            {p.name === "revenue" || p.name === "prevRevenue" || p.name === "projected"
              ? fmtGBP(p.value)
              : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Productivity matrix config & tooltip ────────────────────────────────────

const MATRIX_QUAD = {
  "star":        { label: "Stars",       icon: "★",  color: "#10B981", hint: "Fast sellers, lean stock — guard against stockout" },
  "cash-cow":    { label: "Cash Cows",   icon: "🐄", color: "#3B82F6", hint: "Fast sellers, deep stock — your healthy engine" },
  "dead-weight": { label: "Dead Weight", icon: "💀", color: "#EF4444", hint: "Slow sellers, heavy stock — capital frozen, promote" },
  "question":    { label: "Question",    icon: "❓", color: "#9CA3AF", hint: "Slow sellers, lean stock — low priority, monitor" },
} as const;

function MatrixTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  const { fmtCurrency: fmtGBP } = useCurrency();
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  const q = MATRIX_QUAD[p.quadrant as keyof typeof MATRIX_QUAD];
  return (
    <div className="rounded-lg border bg-card p-2.5 shadow-lg text-xs max-w-[220px]">
      <p className="font-semibold mb-1 line-clamp-2">{p.name}</p>
      <p className="text-muted-foreground mb-1.5">{p.sku}</p>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="w-2 h-2 rounded-sm inline-block" style={{ background: q?.color }} />
        <span className="font-medium">{q?.icon} {q?.label}</span>
      </div>
      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Sold (30d)</span><span className="font-medium tabular-nums">{p.velocity} units</span></div>
      <div className="flex justify-between gap-4"><span className="text-muted-foreground">In stock</span><span className="font-medium tabular-nums">{p.stock} units</span></div>
      <div className="flex justify-between gap-4"><span className="text-muted-foreground">Capital</span><span className="font-medium tabular-nums">{fmtGBP(p.value)}</span></div>
    </div>
  );
}

// ─── Alert strip ─────────────────────────────────────────────────────────────

function AlertStrip({ onDismiss, oos, winners, pendingOrders, pendingApprovals }: {
  onDismiss: () => void;
  oos: number | null;
  winners: number | null;
  pendingOrders: number | null;
  pendingApprovals: number | null;
}) {
  const navigate = useNavigate();
  const f = (n: number | null) => n != null ? fmtNum(n) : "—";
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-300 bg-gradient-to-r from-amber-50 to-card dark:from-amber-950/30 dark:border-amber-800 text-sm flex-wrap">
      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 font-semibold text-xs shrink-0">
        <AlertTriangle size={12} strokeWidth={2.4} /> Operations summary
      </span>
      <div className="flex items-center gap-3 text-xs flex-wrap">
        <button onClick={() => navigate("/replenishment")} className="hover:underline">
          <span className="font-semibold text-red-600 dark:text-red-400">{f(oos)}</span>{" "}
          <span className="text-muted-foreground">SKUs out of stock</span>
        </button>
        <span className="text-border">·</span>
        <button onClick={() => navigate("/replenishment")} className="hover:underline">
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">{f(winners)}</span>{" "}
          <span className="text-muted-foreground">active SKUs</span>
        </button>
        <span className="text-border">·</span>
        <button onClick={() => navigate("/orders")} className="hover:underline">
          <span className="font-semibold text-amber-600 dark:text-amber-400">{f(pendingOrders)}</span>{" "}
          <span className="text-muted-foreground">orders pending fulfillment</span>
        </button>
        <span className="text-border">·</span>
        <button onClick={() => navigate("/approvals")} className="hover:underline">
          <span className="font-semibold text-violet-600 dark:text-violet-400">{f(pendingApprovals)}</span>{" "}
          <span className="text-muted-foreground">approvals awaiting review</span>
        </button>
      </div>
      <div className="flex-1" />
      <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0" onClick={() => navigate("/orders")}>
        <CheckSquare size={11} /> Review orders
      </Button>
      <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground shrink-0">
        <X size={14} />
      </button>
    </div>
  );
}

// ─── Sync progress banner ────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  products:    "Syncing products",
  collections: "Syncing collections",
  orders:      "Syncing orders",
  inventory:   "Syncing inventory",
  complete:    "Sync complete",
};

const STAGE_PCT: Record<string, number> = {
  products:    15,
  collections: 35,
  orders:      65,
  inventory:   85,
  complete:    100,
};

function SyncProgressBanner({ storeName, stage, recordsSynced, status }: {
  storeName: string;
  stage: string | null;
  recordsSynced: number;
  status: string | null;
}) {
  const pct    = STAGE_PCT[stage ?? "products"] ?? 10;
  const label  = STAGE_LABELS[stage ?? "products"] ?? "Syncing…";
  const done   = status === "success" || stage === "complete";
  const failed = status === "failed";

  return (
    <div className="flex items-center gap-3 py-2.5 px-1 text-sm">
      {/* Store label */}
      <span className={cn(
        "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide",
        failed
          ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
          : done
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
            : "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
      )}>
        {storeName}
      </span>

      {/* Spinner / icon */}
      {failed ? (
        <XCircle size={13} className="shrink-0 text-red-500" />
      ) : done ? (
        <CheckSquare size={13} className="shrink-0 text-emerald-600" />
      ) : (
        <Loader2 size={13} className="shrink-0 animate-spin text-indigo-500 dark:text-indigo-400" />
      )}

      {/* Stage label */}
      <span className={cn("shrink-0 text-xs font-medium w-36",
        failed ? "text-red-600" : done ? "text-emerald-700 dark:text-emerald-400" : "text-indigo-700 dark:text-indigo-300")}>
        {failed ? "Sync failed" : done ? "Sync complete" : `${label}…`}
      </span>

      {/* Progress bar */}
      {!done && !failed ? (
        <>
          <div className="flex-1 h-1.5 bg-indigo-200/60 dark:bg-indigo-900/60 rounded-full overflow-hidden min-w-[60px]">
            <div className="h-full rounded-full bg-indigo-500 dark:bg-indigo-400 transition-all duration-700 ease-out"
              style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs font-bold tabular-nums text-indigo-600 dark:text-indigo-400 shrink-0 w-9 text-right">
            {pct}%
          </span>
          <span className="text-xs text-muted-foreground shrink-0">
            {fmtNum(recordsSynced)} records synced
          </span>
        </>
      ) : (
        <span className="text-xs text-muted-foreground shrink-0">
          {done
            ? "All data refreshed"
            : "Check your Shopify connection and try again"}
        </span>
      )}
    </div>
  );
}

// ─── Date range picker ───────────────────────────────────────────────────────

function DateRangePicker({ from, to, isActive, onChange, onOpen }: {
  from: Date | null;
  to: Date | null;
  isActive: boolean;
  onChange: (from: Date, to: Date) => void;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selecting, setSelecting] = useState<{ from: Date; to?: Date } | undefined>(undefined);

  const label = from && to
    ? `${format(from, "dd MMM")} – ${format(to, "dd MMM")}`
    : "Custom";

  function handleOpenChange(next: boolean) {
    if (next) {
      // Reset to last confirmed range (or clear) each time user opens the picker
      setSelecting(from && to ? { from, to } : undefined);
      onOpen();
    }
    setOpen(next);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "px-2.5 py-1 text-xs font-medium transition-colors border-l flex items-center gap-1",
            isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"
          )}>
          {isActive && from ? <CalendarDays size={10} strokeWidth={2.2} /> : null}
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end" sideOffset={8}>
        <Calendar
          mode="range"
          selected={selecting}
          onSelect={(range) => {
            const next = range?.from ? { from: range.from, to: range.to } : undefined;
            setSelecting(next);
            if (next?.from && next?.to) {
              onChange(next.from, next.to);
              setOpen(false);
            }
          }}
          numberOfMonths={2}
          disabled={{ after: new Date() }}
          initialFocus
        />
        {selecting?.from && !selecting?.to && (
          <p className="text-[11px] text-muted-foreground text-center pb-3">
            Click a second date to complete the range
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtLag(hours: number): string {
  if (hours <= 0) return "—";
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

// ─── Sales section ───────────────────────────────────────────────────────────

function TopProductsSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-t first:border-t-0">
          <div className="w-8 h-8 rounded-md bg-muted animate-pulse shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="h-3 bg-muted animate-pulse rounded w-3/4" />
            <div className="h-2.5 bg-muted animate-pulse rounded w-1/2" />
          </div>
          <div className="text-right shrink-0 w-20 space-y-1.5">
            <div className="h-3 bg-muted animate-pulse rounded w-full" />
            <div className="h-2.5 bg-muted animate-pulse rounded w-2/3 ml-auto" />
          </div>
          <div className="w-[70px] h-6 bg-muted animate-pulse rounded shrink-0" />
          <div className="w-10 h-5 bg-muted animate-pulse rounded shrink-0" />
        </div>
      ))}
    </>
  );
}

function SalesSection({ bounds, range, onRangeChange, onSyncStart, syncing,
  customFrom, customTo, setCustomFrom, setCustomTo }: {
  bounds: DateBounds;
  range: DateRangeKey;
  onRangeChange: (r: DateRangeKey) => void;
  onSyncStart: () => void;
  syncing: boolean;
  customFrom: Date | null;
  customTo: Date | null;
  setCustomFrom: (d: Date | null) => void;
  setCustomTo: (d: Date | null) => void;
}) {
  const navigate = useNavigate();
  const [showTopProductsModal, setShowTopProductsModal] = useState(false);
  const { fmtCurrency: fmtGBP, fmtAxis: fmtAxisGBP, symbol } = useCurrency();
  const { data: liveProducts, isLoading: productsLoading, error: productsError } = useTopProducts(6, bounds);
  const { data: trendData,    isLoading: trendLoading }    = useSalesTrend(30, bounds);
  const { data: channelData,  isLoading: channelLoading }  = useChannelPerformance(30, bounds);
  const { data: salesKPIs,    isLoading: kpisLoading }     = useSalesKPIs(bounds);
  const { data: mtdKPIs }                                  = useSalesKPIs();
  const { data: collectionData, isLoading: collectionsLoading } = useCollectionSales(bounds);
  const { data: customerMetrics, isLoading: customerLoading }   = useCustomerMetrics(bounds);
  const { data: fulfillmentMetrics, isLoading: fulfillmentLoading } = useFulfillmentMetrics(bounds);
  const { data: bundleSales, isLoading: bundleLoading } = useBundleSales(bounds);
  // ── new marketing cards ──────────────────────────────────────────────────────
  const { data: discountData,    isLoading: discountLoading }    = useDiscountUsage(bounds);
  const { data: trafficSources,  isLoading: trafficLoading }     = useTrafficSources(bounds);
  const { data: conversionData,  isLoading: conversionLoading }  = useChannelConversion(bounds);
  const { data: abandonmentData, isLoading: abandonmentLoading } = useCheckoutAbandonment(bounds);
  const { data: utmCampaigns,    isLoading: utmLoading }         = useUTMCampaigns(bounds);
  const sparkRev = trendData ? trendData.slice(-14).map(d => d.revenue) : [];
  const sparkOrd = trendData ? trendData.slice(-14).map(d => d.orders) : [];
  const totalChannelRevenue = channelData ? channelData.reduce((s, c) => s + c.revenue, 0) : 0;

  // Projected month-end (always MTD-based regardless of selected range)
  const today = new Date();
  const daysElapsed  = Math.max(1, today.getDate());
  const daysInMonth  = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysRemaining = daysInMonth - today.getDate();
  const mtdRevenue   = mtdKPIs?.revenueMTD ?? 0;
  const runRatePerDay = mtdRevenue / daysElapsed;
  const projectedMonthEnd = runRatePerDay * daysInMonth;

  // Extend trend with projected future days (only for MTD range)
  const extendedTrendData = useMemo(() => {
    if (!trendData?.length) return trendData ?? [];
    if (range !== "MTD" || daysRemaining <= 0) return trendData;
    const result = [...trendData];
    for (let d = 1; d <= daysRemaining; d++) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + d);
      result.push({
        date,
        label: date.toLocaleDateString("en-GB", { month: "short", day: "numeric" }),
        revenue: 0,
        orders: 0,
        prevRevenue: 0,
        prevOrders: 0,
        projected: runRatePerDay,
        isProjected: true,
      });
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trendData, range, runRatePerDay, daysRemaining]);

  const handleExport = useCallback(() => {
    const rows: string[][] = [];
    rows.push(["Sales Dashboard Export", bounds.label]);
    rows.push([]);
    rows.push(["KPIs"]);
    rows.push(["Metric", "Value"]);
    if (salesKPIs) {
      rows.push(["Revenue", salesKPIs.revenueMTD.toFixed(2)]);
      rows.push(["Orders", String(salesKPIs.ordersMTD)]);
      rows.push(["AOV", salesKPIs.aov.toFixed(2)]);
      rows.push(["Sell-Through %", salesKPIs.sellThrough.toFixed(1)]);
      rows.push(["Refund Rate (orders) %", String(salesKPIs.refundRate)]);
      rows.push([`Refund Rate (${symbol}) %`, String(salesKPIs.refundAmountRate)]);
      rows.push(["Refunded Revenue", salesKPIs.refundedRevenue.toFixed(2)]);
      rows.push(["Pending Orders", String(salesKPIs.pendingOrders)]);
    }
    rows.push([]);
    rows.push(["Top Products"]);
    rows.push(["Name", "SKU", "Vendor", "Units", "Revenue", "Trend %"]);
    (liveProducts ?? []).forEach(p => {
      rows.push([p.name, p.sku, p.vendor, String(p.units), p.revenue.toFixed(2), p.trend === null ? "N/A" : String(p.trend)]);
    });
    rows.push([]);
    rows.push(["Channel Performance"]);
    rows.push(["Channel", "Revenue", "Orders", "AOV", "Share %"]);
    (channelData ?? []).forEach(c => {
      rows.push([c.name, c.revenue.toFixed(2), String(c.orders), c.aov.toFixed(2), String(c.share)]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `sales-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [salesKPIs, liveProducts, channelData, bounds.label]);

  return (
    <>
    <div className="space-y-3.5">
      {/* Section header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-primary/10 text-primary">Sales</span>
          <h2 className="text-base font-semibold">Sales overview</h2>
          <span className="text-xs text-muted-foreground">{bounds.label} · {comparePeriodLabel(range)}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border overflow-hidden">
              {(["Today","WTD","MTD","QTD","YTD"] as DateRangeKey[]).map(r => (
                <button key={r} onClick={() => onRangeChange(r)}
                  className={cn("px-2.5 py-1 text-xs font-medium transition-colors",
                    range === r ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground")}>
                  {r}
                </button>
              ))}
              <DateRangePicker
                from={customFrom}
                to={customTo}
                isActive={range === "Custom"}
                onOpen={() => onRangeChange("Custom")}
                onChange={(from, to) => {
                  setCustomFrom(from);
                  setCustomTo(to);
                  if (from && to) onRangeChange("Custom");
                }}
              />
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={handleExport}
            disabled={!salesKPIs && !liveProducts}>
            <Download size={12} /> Export
          </Button>
          <UITooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={onSyncStart} disabled={syncing}>
                {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {syncing ? "Syncing…" : "Sync Sales"}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Fetch latest orders & products from Shopify</TooltipContent>
          </UITooltip>
        </div>
      </div>

      {/* KPI grid — 6 cols */}
      {kpisLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
          {Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
          <KpiCard icon={Banknote} iconColor="#4f46e5" iconBg="#eef2ff"
            label={`Revenue (${range})`} value={fmtGBP(salesKPIs?.revenueMTD ?? 0)}
            delta={salesKPIs?.revenueDelta ?? undefined}
            deltaUp={(salesKPIs?.revenueDelta ?? 0) >= 0}
            deltaLabel={comparePeriodLabel(range)}
            prevValue={salesKPIs ? `prev ${fmtGBP(salesKPIs.prevRevenue)}` : undefined}
            sparkData={sparkRev} sparkColor="#6366f1" />
          <KpiCard icon={ShoppingCart} iconColor="#7c3aed" iconBg="#ede9fe"
            label={`Orders (${range})`} value={fmtNum(salesKPIs?.ordersMTD ?? 0)}
            delta={salesKPIs?.ordersDelta ?? undefined}
            deltaUp={(salesKPIs?.ordersDelta ?? 0) >= 0}
            deltaLabel={comparePeriodLabel(range)}
            prevValue={salesKPIs ? `prev ${fmtNum(salesKPIs.prevOrders)}` : undefined}
            sparkData={sparkOrd} sparkColor="#8b5cf6" />
          <KpiCard icon={CreditCard} iconColor="#0891b2" iconBg="#cffafe"
            label="Avg. Order Value" value={fmtGBP(salesKPIs?.aov ?? 0)}
            footer={`${fmtNum(salesKPIs?.ordersMTD ?? 0)} orders`} />
          <KpiCard icon={TrendingUp} iconColor="#059669" iconBg="#d1fae5"
            label="Sell-Through %" value={salesKPIs ? salesKPIs.sellThrough.toFixed(1) : "—"} unit="%"
            footer="current month" />
          <KpiCard icon={Activity} iconColor="#db2777" iconBg="#fce7f3"
            label="Refund rate (orders)"
            value={salesKPIs ? `${salesKPIs.refundRate}%` : "—"}
            footer={salesKPIs ? `${fmtNum(salesKPIs.ordersMTD > 0 ? Math.round(salesKPIs.refundRate * salesKPIs.ordersMTD / 100) : 0)} orders refunded` : "—"} />
          <KpiCard icon={ReceiptText} iconColor="#7c3aed" iconBg="#ede9fe"
            label={`Refund rate (${symbol})`}
value={salesKPIs ? `${salesKPIs.refundAmountRate ?? 0}%` : "—"}
footer={salesKPIs ? `${fmtGBP(salesKPIs.refundedRevenue ?? 0)} refunded` : "—"} />
        </div>
      )}

      {/* CEO insights row — 5 cols */}
      {(customerLoading || fulfillmentLoading || kpisLoading || bundleLoading) ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
          {Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
          <KpiCard icon={Users} iconColor="#0891b2" iconBg="#cffafe"
            label="New Customers"
            value={customerMetrics?.totalCustomers ? `${customerMetrics.newPct.toFixed(1)}%` : "—"}
            footer={customerMetrics?.totalCustomers ? `${fmtNum(customerMetrics.newCustomers)} customers · ${fmtGBP(customerMetrics.newRevenue)}` : "Sync to populate"}
            progress={customerMetrics?.totalCustomers ? customerMetrics.newPct : 0}
            progressColor="#0891b2" />
          <KpiCard icon={Repeat2} iconColor="#7c3aed" iconBg="#ede9fe"
            label="Returning Customers"
            value={customerMetrics?.totalCustomers ? `${customerMetrics.returningPct.toFixed(1)}%` : "—"}
            footer={customerMetrics?.totalCustomers ? `${fmtNum(customerMetrics.returningCustomers)} customers · ${fmtGBP(customerMetrics.returningRevenue)}` : "Sync to populate"}
            progress={customerMetrics?.totalCustomers ? customerMetrics.returningPct : 0}
            progressColor="#7c3aed" />
          <KpiCard icon={Clock} iconColor="#d97706" iconBg="#fef3c7"
            label="Avg. fulfillment time"
            value={fulfillmentMetrics ? fmtLag(fulfillmentMetrics.avgLagHours) : "—"}
            footer={fulfillmentMetrics ? `${fmtNum(fulfillmentMetrics.ordersAnalyzed)} orders analysed` : "—"} />
          <KpiCard icon={Target} iconColor="#059669" iconBg="#d1fae5"
            label="Projected month-end"
            value={fmtGBP(projectedMonthEnd)}
            footer={`at current run rate · ${fmtNum(daysRemaining)}d remaining`}
            progress={Math.round((daysElapsed / daysInMonth) * 100)}
            progressColor="#059669" />
          <KpiCard icon={Layers} iconColor="#b45309" iconBg="#fef3c7"
            label="Bundle vs Others"
            value={fmtGBP(bundleSales?.totalRevenue ?? 0)}
            delta={bundleSales?.bundleDelta ?? undefined}
            deltaUp={(bundleSales?.bundleDelta ?? 0) >= 0}
            footer={bundleSales
              ? `Bundle ${fmtGBP(bundleSales.bundleRevenue)} · Others ${fmtGBP(bundleSales.othersRevenue)}`
              : "Loading…"}
            progress={bundleSales?.bundleShare ?? 0}
            progressColor="#b45309" />
        </div>
      )}

      {/* Trend chart + Channel donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold">Revenue trend
                  <span className="text-muted-foreground font-normal ml-1.5">{bounds.label}</span>
                </h3>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-indigo-500 rounded" />Revenue</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-indigo-300 rounded" style={{ borderTop: "2px dashed #a5b4fc" }} />Prev Revenue</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 bg-violet-400 rounded" style={{ borderTop: "2px dashed #c4b5fd" }} />Orders</span>
                  {range === "MTD" && daysRemaining > 0 && (
                    <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 rounded" style={{ borderTop: "2px dashed #f59e0b" }} />Projected</span>
                  )}
                </div>
              </div>
              <button className="text-muted-foreground hover:text-foreground"><MoreHorizontal size={14} /></button>
            </div>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            {trendLoading ? (
              <div className="w-full h-[220px] flex flex-col gap-2 px-2 pt-2 pb-0">
                <div className="flex-1 bg-muted animate-pulse rounded-md" />
                <div className="flex justify-between gap-6 h-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex-1 bg-muted animate-pulse rounded" />
                  ))}
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={extendedTrendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} minTickGap={40} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="left" tickFormatter={fmtAxisGBP} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={40} />
                  <YAxis yAxisId="right" orientation="right" hide />
                  <Tooltip content={<TrendTooltip />} />
                  <Area yAxisId="left" type="monotone" dataKey="revenue" fill="url(#trendGrad)" stroke="#6366f1" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line yAxisId="left" type="monotone" dataKey="prevRevenue" stroke="#a5b4fc" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                  <Line yAxisId="right" type="monotone" dataKey="orders" stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                  <Line yAxisId="right" type="monotone" dataKey="prevOrders" stroke="#c4b5fd" strokeWidth={1} strokeDasharray="2 4" dot={false} isAnimationActive={false} />
                  <Line yAxisId="left" type="monotone" dataKey="projected" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Sales by channel</h3>
              <span className="text-xs text-muted-foreground">
                {channelLoading ? <span className="inline-block w-14 h-3 bg-muted animate-pulse rounded" /> : fmtGBP(totalChannelRevenue)}
              </span>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {channelLoading ? (
              <div className="flex items-center gap-4">
                <div className="w-[130px] h-[130px] rounded-full bg-muted animate-pulse shrink-0" />
                <div className="flex-1 space-y-2.5">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-sm bg-muted animate-pulse shrink-0" />
                      <div className="flex-1 h-2.5 bg-muted animate-pulse rounded" />
                      <div className="w-12 h-2.5 bg-muted animate-pulse rounded" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <DonutChart
                data={(channelData ?? []).map(c => ({ name: c.name, value: c.revenue, color: c.color, formatted: fmtGBP(c.revenue), orders: c.orders }))}
                centerLabel="Total" centerValue={fmtGBP(totalChannelRevenue)}
                size={130} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top products + Collections + Orders summary */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3.5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Top selling products
                <span className="text-muted-foreground font-normal ml-1.5">by revenue · {range}</span>
              </h3>
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setShowTopProductsModal(true)}>
                View all <ChevronRight size={11} />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {productsLoading ? (
              <TopProductsSkeleton />
            ) : productsError ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                Failed to load products
              </div>
            ) : !liveProducts?.length ? (
              <div className="px-4 py-8 text-center">
                <Package size={28} className="mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">No product data available</p>
              </div>
            ) : (
              liveProducts.map((p, i) => (
                <div key={p.product_id} className="flex items-center gap-3 px-4 py-2.5 border-t first:border-t-0 hover:bg-muted/40 transition-colors">
                  <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <Package size={14} className="text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.vendor} · <span className="font-mono">{p.sku}</span></div>
                  </div>
                  <div className="text-right shrink-0 w-20">
                    <div className="text-sm font-semibold">{fmtGBP(p.revenue)}</div>
                    <div className="text-xs text-muted-foreground">{p.units} units</div>
                  </div>
                  <div className="w-[70px] shrink-0">
                    <Sparkline
                      data={Array.from({ length: 12 }, (_, k) => 50 + Math.sin(i + k * 0.7) * 25 + ((p.trend ?? 0) > 0 ? k : -k) * 2)}
                      color={p.trend === null ? "#94a3b8" : p.trend > 0 ? "#10b981" : "#ef4444"} />
                  </div>
                  {p.trend === null ? (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 text-muted-foreground border-muted-foreground/30 bg-muted/40">
                      —
                    </Badge>
                  ) : (
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 shrink-0 gap-0.5",
                      p.trend > 0
                        ? "text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-400"
                        : "text-red-500 border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400")}>
                      {p.trend > 0 ? <ArrowUp size={8} strokeWidth={2.5} /> : <ArrowDown size={8} strokeWidth={2.5} />}
                      {Math.abs(p.trend)}%
                    </Badge>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-2 flex flex-col gap-3.5">
          <Card className="flex-1">
            <CardHeader className="pb-2 pt-4 px-4">
              <h3 className="text-sm font-semibold">Sales by collection
                <span className="text-muted-foreground font-normal ml-1.5">{bounds.label}</span>
              </h3>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              {collectionsLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-20 h-2.5 bg-muted animate-pulse rounded" />
                    <div className="flex-1 h-1.5 bg-muted animate-pulse rounded-full" />
                    <div className="w-14 h-2.5 bg-muted animate-pulse rounded" />
                  </div>
                ))
              ) : !collectionData?.length ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No collection data</p>
              ) : (() => {
                const max = Math.max(...collectionData.map(c => c.revenue));
                return collectionData.map(c => (
                  <div key={c.name} className="flex items-center gap-2 text-xs">
                    <span className="w-20 text-muted-foreground truncate">{c.name}</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(c.revenue / max) * 100}%`, background: c.color }} />
                    </div>
                    <span className="w-14 text-right font-medium tabular-nums">{fmtGBP(c.revenue)}</span>
                  </div>
                ));
              })()}
            </CardContent>
          </Card>

          <Card className="flex-1">
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Orders summary</h3>
                <span className="text-xs text-muted-foreground">MTD</span>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {kpisLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="h-2.5 bg-muted animate-pulse rounded w-24" />
                      <div className="h-2.5 bg-muted animate-pulse rounded w-12" />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Total orders</span>
                      <span className="font-semibold tabular-nums">{fmtNum(salesKPIs?.ordersMTD ?? 0)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Pending fulfillment</span>
                      <span className="font-semibold tabular-nums text-amber-600">{fmtNum(salesKPIs?.pendingOrders ?? 0)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Avg. order value</span>
                      <span className="font-semibold tabular-nums">{fmtGBP(salesKPIs?.aov ?? 0)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Refund rate (orders)</span>
                      <span className="font-semibold tabular-nums">{salesKPIs?.refundRate ?? 0}%</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Refund rate ({symbol})</span>
                      <span className="font-semibold tabular-nums text-red-500">{salesKPIs?.refundAmountRate ?? 0}%</span>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden">
                    {salesKPIs && salesKPIs.ordersMTD > 0 && (
                      <div className="h-full rounded-full bg-amber-400 transition-all"
                        style={{ width: `${Math.min(100, (salesKPIs.pendingOrders / salesKPIs.ordersMTD) * 100)}%` }} />
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {salesKPIs && salesKPIs.ordersMTD > 0
                      ? `${Math.round((salesKPIs.pendingOrders / salesKPIs.ordersMTD) * 100)}% awaiting fulfillment`
                      : "No orders this month"}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Marketing cards: Discount · Traffic · Channel conversion ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">

        {/* Card 1 — Discount Usage Rate */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center gap-2">
              <Tag size={14} className="text-violet-500" />
              <h3 className="text-sm font-semibold">Discount usage</h3>
              <span className="text-xs text-muted-foreground">{bounds.label}</span>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {discountLoading ? (
              <div className="space-y-2">
                <div className="h-8 bg-muted animate-pulse rounded w-24" />
                <div className="h-3 bg-muted animate-pulse rounded w-48" />
                <div className="h-1.5 bg-muted animate-pulse rounded-full mt-3" />
                <div className="h-3 bg-muted animate-pulse rounded w-44 mt-4" />
                <div className="h-1.5 bg-muted animate-pulse rounded-full mt-2" />
              </div>
            ) : (
              <>
                <div className="text-[28px] font-semibold tabular-nums tracking-tight">
                  {discountData?.rate ?? 0}%
                </div>
                {/* Orders row */}
                <p className="text-xs text-muted-foreground mt-1">
                  {fmtNum(discountData?.discountedOrders ?? 0)} of {fmtNum(discountData?.totalOrders ?? 0)} orders used a discount
                </p>
                <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-violet-500 transition-all"
                    style={{ width: `${Math.min(100, discountData?.rate ?? 0)}%` }} />
                </div>
                {/* Revenue row */}
                <p className="text-xs text-muted-foreground mt-3">
                  {fmtGBP(discountData?.discountedRevenue ?? 0)} of {fmtGBP(discountData?.totalRevenue ?? 0)} revenue from discounted orders
                </p>
                <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-violet-400 transition-all"
                    style={{ width: `${Math.min(100, discountData?.revenueRate ?? 0)}%` }} />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Card 2 — Traffic Sources */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center gap-2">
              <Globe size={14} className="text-muted-foreground" />
              <h3 className="text-sm font-semibold">Traffic sources</h3>
              <span className="text-xs text-muted-foreground">{bounds.label}</span>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {trafficLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-20 h-2.5 bg-muted animate-pulse rounded" />
                  <div className="flex-1 h-1.5 bg-muted animate-pulse rounded-full" />
                  <div className="w-10 h-2.5 bg-muted animate-pulse rounded" />
                </div>
              ))
            ) : !trafficSources?.length ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No referral data</p>
            ) : (() => {
              const maxOrders = Math.max(...(trafficSources ?? []).map(s => s.orders));
              return (trafficSources ?? []).map(s => (
                <div key={s.name} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-muted-foreground truncate shrink-0">{s.name}</span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${maxOrders > 0 ? (s.orders / maxOrders) * 100 : 0}%` }} />
                  </div>
                  <span className="w-12 text-right tabular-nums font-medium shrink-0">{fmtNum(s.orders)}</span>
                  <span className="w-9 text-right tabular-nums text-muted-foreground shrink-0">{s.share}%</span>
                </div>
              ));
            })()}
          </CardContent>
        </Card>

        {/* Card 3 — Conversion by Channel */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center gap-2">
              <Layers size={14} className="text-muted-foreground" />
              <h3 className="text-sm font-semibold">Conversion by channel</h3>
              <span className="text-xs text-muted-foreground">top 5</span>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {conversionLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-20 h-2.5 bg-muted animate-pulse rounded" />
                  <div className="flex-1 h-1.5 bg-muted animate-pulse rounded-full" />
                  <div className="w-14 h-2.5 bg-muted animate-pulse rounded" />
                </div>
              ))
            ) : !conversionData?.length ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No channel data</p>
            ) : (() => {
              const maxOrders = Math.max(...(conversionData ?? []).map(c => c.orders));
              const CONV_COLORS = ["#5E5CE6","#EC4899","#10B981","#F59E0B","#06B6D4"];
              return (conversionData ?? []).map((c, i) => (
                <div key={c.name} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-muted-foreground truncate shrink-0">{c.name}</span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full"
                      style={{ width: `${maxOrders > 0 ? (c.orders / maxOrders) * 100 : 0}%`, background: CONV_COLORS[i % CONV_COLORS.length] }} />
                  </div>
                  <span className="w-12 text-right tabular-nums font-medium shrink-0">{fmtNum(c.orders)}</span>
                  <span className="w-14 text-right tabular-nums text-muted-foreground shrink-0">{fmtGBP(c.revenue)}</span>
                </div>
              ));
            })()}
          </CardContent>
        </Card>

      </div>

      {/* ── second marketing row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3.5">

        {/* Card 4 — Checkout Abandonment */}
        <Card className="col-span-2">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center gap-2">
              <ShoppingCart size={14} className="text-amber-500" />
              <h3 className="text-sm font-semibold">Checkout abandonment</h3>
              <span className="text-xs text-muted-foreground">{bounds.label}</span>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {abandonmentLoading ? (
              <div className="space-y-2">
                <div className="h-8 bg-muted animate-pulse rounded w-20" />
                <div className="h-3 bg-muted animate-pulse rounded w-52" />
                <div className="h-1.5 bg-muted animate-pulse rounded-full mt-3" />
                <div className="h-3 bg-muted animate-pulse rounded w-44 mt-4" />
              </div>
            ) : !abandonmentData?.hasSynced ? (
              <div className="py-3 space-y-1.5">
                <p className="text-xs text-muted-foreground">No data yet — run a store sync to populate abandoned checkout records.</p>
                <p className="text-[11px] text-muted-foreground/60">Shopify tracks checkouts started but not completed.</p>
              </div>
            ) : (
              <>
                <div className="text-[28px] font-semibold tabular-nums tracking-tight">
                  {abandonmentData.abandonmentRate}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {fmtNum(abandonmentData.abandoned)} abandoned · {fmtNum(abandonmentData.completedOrders)} completed
                </p>
                <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-amber-500 transition-all"
                    style={{ width: `${Math.min(100, abandonmentData.abandonmentRate)}%` }} />
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  <span className="font-medium text-foreground">{fmtGBP(abandonmentData.revenueAtRisk)}</span> revenue at risk from abandoned carts
                </p>
              </>
            )}
          </CardContent>
        </Card>



      </div>
      {/* ── end marketing cards ──────────────────────────────────────────────── */}

      {/* Channel performance table */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Channel performance</h3>
            <Button size="sm" variant="ghost" className="h-7 text-xs">Manage channels</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                {["Channel","Revenue","Orders","AOV","Share","Trend (14d)",""].map((h, i) => (
                  <th key={i} className={cn("px-4 py-2.5 font-medium text-muted-foreground text-left",
                    i >= 1 && i <= 4 && "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {channelLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b last:border-b-0">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-muted animate-pulse shrink-0" />
                        <div className="w-24 h-3 bg-muted animate-pulse rounded" />
                      </div>
                    </td>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-4 py-2.5 text-right">
                        <div className="h-3 bg-muted animate-pulse rounded w-16 ml-auto" />
                      </td>
                    ))}
                    <td className="px-4 py-2.5">
                      <div className="w-[70px] h-6 bg-muted animate-pulse rounded" />
                    </td>
                    <td />
                  </tr>
                ))
              ) : !channelData?.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No channel data available</td>
                </tr>
              ) : (
                channelData.map(c => (
                  <tr key={c.key} className="border-b last:border-b-0 hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: c.color + "22", color: c.color }}>
                          <span className="text-[9px] font-bold">{c.name[0]}</span>
                        </span>
                        <span className="font-medium">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">{fmtGBP(c.revenue)}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">{fmtNum(c.orders)}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">{fmtGBP(c.aov)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-14 h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${c.share}%`, background: c.color }} />
                        </div>
                        <span className="tabular-nums w-9 text-right">{c.share}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Sparkline data={c.dailyRevenue} color={c.color} />
                    </td>
                    <td className="px-4 py-2.5">
                      <button className="text-muted-foreground hover:text-foreground"><MoreHorizontal size={14} /></button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </CardContent>
      </Card>
    </div>

    <TopProductsModal
      open={showTopProductsModal}
      onClose={() => setShowTopProductsModal(false)}
      bounds={bounds}
      range={range}
    />
    </>
  );
}

// ─── Inventory section ───────────────────────────────────────────────────────

function KpiSkeleton() {
  return (
    <Card><CardContent className="p-4 space-y-2">
      <div className="h-3 bg-muted animate-pulse rounded w-20" />
      <div className="h-6 bg-muted animate-pulse rounded w-28" />
      <div className="h-2.5 bg-muted animate-pulse rounded w-24" />
    </CardContent></Card>
  );
}

function RowSkeleton({ cols = 5 }: { cols?: number }) {
  return (
    <tr className="border-b last:border-b-0">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-2.5">
          <div className="h-3 bg-muted animate-pulse rounded" style={{ width: i === 0 ? "80%" : "60%" }} />
        </td>
      ))}
    </tr>
  );
}

function InventorySection({ onSyncStart, syncing }: { onSyncStart: () => void; syncing: boolean }) {
  const navigate = useNavigate();
  const { fmtCurrency: fmtGBP } = useCurrency();
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "draft">("all");
  const [showLosersModal, setShowLosersModal] = useState(false);
  const [deadstockFilter, setDeadstockFilter] = useState("all");
  const [deadstockSelected, setDeadstockSelected] = useState<Set<string>>(new Set());
  const { data, isLoading } = useInventoryDashboard(statusFilter);
  const { data: deadstockData, isLoading: deadstockLoading } = useDeadstockPreview(8, deadstockFilter);
  const { data: deadstockSummary } = useDeadstockSummary();

  function handleCreateDiscount(ids: string[]) {
    sessionStorage.setItem("campaign_prefill_products", JSON.stringify(ids));
    navigate("/manual-sync");
  }

  function toggleDeadstockRow(id: string) {
    setDeadstockSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleDeadstockAll(allIds: string[]) {
    setDeadstockSelected(prev =>
      prev.size === allIds.length ? new Set() : new Set(allIds)
    );
  }

  const available   = data?.kpis.available ?? 0;
  const stockValue  = data?.stockValue  ?? 0;
  const oos         = data?.kpis.outOfStock ?? 0;
  const winners     = data?.kpis.winners ?? 0;
  const losersCount = data?.kpis.losers ?? 0;
  const sparkInv    = Array.from({ length: 14 }, (_, i) => Math.max(0, available - i * 80 + Math.sin(i) * 200));
  const totalCategoryUnits = data?.categories.reduce((s, c) => s + c.units, 0) ?? 0;

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Inventory</span>
          <h2 className="text-base font-semibold">Inventory health</h2>
          <span className="text-xs text-muted-foreground">Across all stores · live</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-muted border text-xs">
            {(["all", "active", "draft"] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={cn("px-2.5 py-1 rounded-md font-medium transition-all capitalize",
                  statusFilter === s ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {s === "all" ? "All" : s === "active" ? "Active" : "Draft"}
              </button>
            ))}
          </div>
          <UITooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={onSyncStart} disabled={syncing}>
                {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {syncing ? "Syncing…" : "Sync Inventory"}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Fetch latest inventory levels from Shopify</TooltipContent>
          </UITooltip>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
          {Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
          <KpiCard icon={Boxes} iconColor="#4f46e5" iconBg="#eef2ff"
            label="Available units" value={fmtNum(available)}
            sparkData={sparkInv} sparkColor="#6366f1" />
          <KpiCard icon={Banknote} iconColor="#059669" iconBg="#d1fae5"
            label="Stock value" value={fmtGBP(stockValue)}
            footer="at current prices" />
          <KpiCard icon={XCircle} iconColor="#dc2626" iconBg="#fee2e2"
            label="Out of stock" value={fmtNum(oos)}
            footer="needs replenishment" />
          <KpiCard icon={Award} iconColor="#059669" iconBg="#d1fae5"
            label="Winners" value={fmtNum(winners)}
            footer={winners + losersCount > 0 ? `${Math.round(winners / (winners + losersCount) * 100)}% of active SKUs` : "—"} />
          <KpiCard icon={TrendingDown} iconColor="#dc2626" iconBg="#fee2e2"
            label="Losers" value={fmtNum(losersCount)}
            footer=">20 days on shelf" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Inventory Productivity Matrix
                <span className="text-muted-foreground font-normal ml-1.5">sales velocity × stock held · bubble = capital</span>
              </h3>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowLosersModal(true)}>View report</Button>
            </div>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            {isLoading ? (
              <div className="w-full h-[200px] px-2 pt-2 bg-muted/40 animate-pulse rounded" />
            ) : (() => {
              const matrix = data?.productivityMatrix;
              const vT = matrix?.velThreshold ?? 1;
              const sT = matrix?.stockThreshold ?? 1;
              const byQuad = (q: string) => (matrix?.points ?? []).filter(p => p.quadrant === q);
              const summary = (q: string) => matrix?.quadrants.find(s => s.key === q);
              return (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <ScatterChart margin={{ top: 8, right: 18, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" dataKey="velocity" name="Sold (30d)"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false}
                      label={{ value: "Sales velocity · units/30d →", position: "insideBottom", offset: -2, fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis type="number" dataKey="stock" name="Stock"
                      tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={36}
                      label={{ value: "Stock held ↑", angle: -90, position: "insideLeft", fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                    <ZAxis type="number" dataKey="value" range={[30, 380]} name="Capital" />
                    <ReferenceLine x={vT} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeOpacity={0.5} />
                    <ReferenceLine y={sT} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeOpacity={0.5} />
                    <Tooltip content={<MatrixTooltip />} cursor={{ strokeDasharray: "3 3" }} />
                    {(Object.keys(MATRIX_QUAD) as Array<keyof typeof MATRIX_QUAD>).map(q => (
                      <Scatter key={q} name={MATRIX_QUAD[q].label} data={byQuad(q)} fill={MATRIX_QUAD[q].color} fillOpacity={0.65} isAnimationActive={false} />
                    ))}
                  </ScatterChart>
                </ResponsiveContainer>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 px-2">
                  {(Object.keys(MATRIX_QUAD) as Array<keyof typeof MATRIX_QUAD>).map(q => {
                    const s = summary(q);
                    const cfg = MATRIX_QUAD[q];
                    const clickable = q === "dead-weight";
                    return (
                      <button
                        key={q}
                        onClick={clickable ? () => navigate("/campaigns") : undefined}
                        className={cn(
                          "text-left rounded-lg border p-2 transition-colors",
                          clickable ? "hover:bg-muted cursor-pointer" : "cursor-default"
                        )}
                        title={cfg.hint}
                      >
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: cfg.color }} />
                          <span className="text-[11px] font-medium">{cfg.icon} {cfg.label}</span>
                        </div>
                        <div className="text-sm font-bold tabular-nums leading-tight">{fmtGBP(s?.value ?? 0)}</div>
                        <div className="text-[10px] text-muted-foreground tabular-nums">{fmtNum(s?.count ?? 0)} SKUs · {fmtNum(s?.units ?? 0)} units</div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2 px-2">
                  Dividers at typical mover ({fmtNum(Math.round(vT))}/30d) &amp; typical depth ({fmtNum(Math.round(sT))} units) · plotting top {matrix?.plotted ?? 0} of {fmtNum(matrix?.total ?? 0)} in-stock SKUs by capital
                </p>
              </>
              );
            })()}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <h3 className="text-sm font-semibold">By Collections <span className="text-muted-foreground font-normal">Top 5</span></h3>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {isLoading ? (
              <div className="flex items-center gap-4">
                <div className="w-[120px] h-[120px] rounded-full bg-muted animate-pulse shrink-0" />
                <div className="flex-1 space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-sm bg-muted animate-pulse shrink-0" />
                      <div className="flex-1 h-2.5 bg-muted animate-pulse rounded" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <DonutChart
                data={(data?.categories ?? []).map(c => ({ name: c.name, value: c.units, color: c.color, formatted: fmtNum(c.units) }))}
                centerLabel="Units" centerValue={fmtNum(totalCategoryUnits)}
                size={120} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Central WMS pool — hidden for now (no master-pool data synced yet; all zeros).
          Restore this block when warehouse/master-pool feed is wired up. */}
      {false && (
      <Card>
        <CardHeader className="pb-1 pt-4 px-4">
          <div className="flex items-center gap-2">
            <Warehouse size={14} className="text-muted-foreground" />
            <h3 className="text-sm font-semibold">Central WMS pool</h3>
            <span className="text-xs text-muted-foreground">Master pool feeding all stores</span>
          </div>
        </CardHeader>
        <CardContent className="p-3">
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <KpiCard label="Central SKUs"    value={fmtNum(data?.wmsPool.totalSKUs ?? 0)}
                icon={Layers}        iconColor="#4f46e5" iconBg="#eef2ff" footer="Master variants" />
              <KpiCard label="Total available" value={fmtNum(data?.wmsPool.totalAvailable ?? 0)}
                icon={ShoppingCart}  iconColor="#059669" iconBg="#d1fae5" footer="Sellable" />
              <KpiCard label="Reserved"        value={fmtNum(data?.wmsPool.totalReserved ?? 0)}
                icon={Clock}         iconColor="#d97706" iconBg="#fef3c7" />
              <KpiCard label="Net available"   value={fmtNum(data?.wmsPool.totalNetAvailable ?? 0)}
                icon={TrendingUp}    iconColor="#7c3aed" iconBg="#ede9fe" />
              <KpiCard label="In transit"      value="—"
                icon={Truck}         iconColor="#0891b2" iconBg="#cffafe" />
              <KpiCard label="Central value"   value={fmtGBP(data?.wmsPool.totalValue ?? 0)}
                icon={Banknote} iconColor="#059669" iconBg="#d1fae5" footer="At base prices" />
            </div>
          )}
        </CardContent>
      </Card>
      )}

      <OutOfStockWidget />

      <DeadstockLosersModal open={showLosersModal} onClose={() => setShowLosersModal(false)} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-0 pt-4 px-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingDown size={14} className="text-red-500" />
                <h3 className="text-sm font-semibold">Shelf life of losers</h3>
                <span className="text-xs text-muted-foreground">{deadstockData?.total ?? 0} products</span>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate("/campaigns")}>Mark for promo</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => setShowLosersModal(true)}>
                  <Eye size={12} /> View all
                </Button>
              </div>
            </div>

            {deadstockSummary && (
              <div className="flex items-center gap-3 pt-2.5 pb-1 flex-wrap text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Deadstock</span>
                  <span className="font-semibold">{fmtNum(deadstockSummary.deadUnits)} units</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-semibold text-red-600 dark:text-red-400">{fmtGBP(deadstockSummary.deadValue)}</span>
                </div>
                <div className="w-px h-3 bg-border shrink-0" />
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Overstocked</span>
                  <span className="font-semibold">{fmtNum(deadstockSummary.overUnits)} units</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-semibold text-purple-600 dark:text-purple-400">{fmtGBP(deadstockSummary.overValue)}</span>
                </div>
                <div className="w-px h-3 bg-border shrink-0" />
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Total at risk</span>
                  <span className="font-bold text-foreground">{fmtGBP(deadstockSummary.deadValue + deadstockSummary.overValue)}</span>
                </div>
              </div>
            )}

            <div className="flex items-center gap-1 pt-2 pb-1 flex-wrap">
              {(["all", "Overstocked", "Dead 90d", "Dead 60d", "Dead 30d"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => { setDeadstockFilter(f); setDeadstockSelected(new Set()); }}
                  className={cn(
                    "text-[10px] px-2.5 py-1 rounded-md font-medium transition-colors",
                    deadstockFilter === f
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  {f === "all" ? "All" : f}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {(() => {
              const visibleIds = deadstockData?.products.map(p => p.product_id) ?? [];
              return deadstockSelected.size > 0 ? (
                <div className="flex items-center justify-between px-4 py-2 bg-primary/5 border-b border-primary/20">
                  <span className="text-xs font-medium text-primary">
                    {deadstockSelected.size} product{deadstockSelected.size > 1 ? "s" : ""} selected
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-muted-foreground"
                      onClick={() => setDeadstockSelected(new Set())}
                    >
                      Clear
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      onClick={() => handleCreateDiscount(Array.from(deadstockSelected))}
                    >
                      <Tag size={11} /> Create discount for {deadstockSelected.size}
                    </Button>
                  </div>
                </div>
              ) : null;
            })()}
            <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="pl-4 pr-2 py-2 w-8">
                    {(() => {
                      const visibleIds = deadstockData?.products.map(p => p.product_id) ?? [];
                      const allChecked = visibleIds.length > 0 && visibleIds.every(id => deadstockSelected.has(id));
                      const someChecked = visibleIds.some(id => deadstockSelected.has(id));
                      return (
                        <Checkbox
                          checked={allChecked}
                          data-state={someChecked && !allChecked ? "indeterminate" : undefined}
                          onCheckedChange={() => toggleDeadstockAll(visibleIds)}
                          className="h-3.5 w-3.5"
                        />
                      );
                    })()}
                  </th>
                  {["Product","Stock","Status","Unit Price","Value at Risk","Last Sale",""].map((h, i) => (
                    <th key={i} className={cn("px-4 py-2 font-medium text-muted-foreground text-left",
                      i >= 1 && i !== 2 && i !== 6 && "text-right")}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deadstockLoading ? (
                  Array.from({ length: 6 }).map((_, i) => <RowSkeleton key={i} cols={6} />)
                ) : !deadstockData?.products.length ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No deadstock or overstocked products</td></tr>
                ) : (
                  deadstockData.products.map(p => {
                    const label = getDeadstockLabel(p);
                    const LABEL_CLS: Record<string, string> = {
                      "Dead 90d":    "text-red-500 border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400",
                      "Dead 60d":    "text-orange-500 border-orange-200 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-800 dark:text-orange-400",
                      "Dead 30d":    "text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400",
                      "Never Sold":  "text-muted-foreground border-dashed",
                      "Overstocked": "text-purple-600 border-purple-200 bg-purple-50 dark:bg-purple-950/30 dark:border-purple-800 dark:text-purple-400",
                    };
                    const ROW_BORDER: Record<string, string> = {
                      "Dead 90d":    "border-l-2 border-l-red-400",
                      "Dead 60d":    "border-l-2 border-l-orange-400",
                      "Dead 30d":    "border-l-2 border-l-amber-400",
                      "Never Sold":  "border-l-2 border-l-muted-foreground/30",
                      "Overstocked": "border-l-2 border-l-purple-400",
                    };
                    let daysAgoStr: JSX.Element | string = <span className="text-red-400 font-medium">Never</span>;
                    if (p.last_sale_at) {
                      try {
                        const days = Math.floor((Date.now() - parseISO(p.last_sale_at).getTime()) / 86400000);
                        const cls = days >= 90 ? "text-red-500" : days >= 60 ? "text-orange-500" : days >= 30 ? "text-amber-600" : "text-muted-foreground";
                        daysAgoStr = <span className={cls}>{days === 0 ? "Today" : days === 1 ? "Yesterday" : `${days}d ago`}</span>;
                      } catch {}
                    }
                    return (
                      <tr key={p.product_id} className={cn("border-b last:border-b-0 hover:bg-muted/40 transition-colors", ROW_BORDER[label] ?? "", deadstockSelected.has(p.product_id) && "bg-primary/5")}>
                        <td className="pl-4 pr-2 py-2.5 w-8">
                          <Checkbox
                            checked={deadstockSelected.has(p.product_id)}
                            onCheckedChange={() => toggleDeadstockRow(p.product_id)}
                            className="h-3.5 w-3.5"
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium">{p.product_name}</div>
                          <div className="font-mono text-muted-foreground text-[10px]">{p.product_type ?? ""}{p.sku ? ` · ${p.sku}` : ""}</div>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmtNum(p.total_units)}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", LABEL_CLS[label] ?? "")}>
                            {label}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmtGBP(p.unit_price)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmtGBP(p.inventory_value)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-xs">{daysAgoStr}</td>
                        <td className="px-2 py-2.5">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground">
                                <MoreHorizontal size={13} />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="text-xs w-44">
                              <DropdownMenuItem className="gap-2 text-xs cursor-pointer" onClick={() => handleCreateDiscount([p.product_id])}>
                                <Tag size={12} /> Create discount
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-3.5">
          <Card className="flex-1">
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center gap-2">
                <Truck size={13} className="text-muted-foreground" />
                <h3 className="text-sm font-semibold">Replenishment queue</h3>
                <span className="text-xs text-muted-foreground">{data?.replenishment.length ?? 0}</span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-t first:border-t-0">
                    <div className="w-7 h-7 rounded-md bg-muted animate-pulse shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-muted animate-pulse rounded w-3/4" />
                      <div className="h-2.5 bg-muted animate-pulse rounded w-1/2" />
                    </div>
                    <div className="w-12 h-4 bg-muted animate-pulse rounded" />
                  </div>
                ))
              ) : !data?.replenishment.length ? (
                <div className="px-4 py-5 text-center text-xs text-muted-foreground">No items need replenishment</div>
              ) : (
                data.replenishment.map(r => (
                  <div key={r.sku} className="px-4 py-2.5 border-t first:border-t-0">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-md bg-muted flex items-center justify-center shrink-0">
                        <Package size={13} className="text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{r.name}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono text-[10px] text-muted-foreground">{r.sku}</span>
                          {r.daysOfStock !== null && (
                            <span className="text-[10px] text-muted-foreground">· {r.daysOfStock}d left</span>
                          )}
                          {r.velocity > 0 && (
                            <span className="text-[10px] text-muted-foreground">· {r.velocity}/wk</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0",
                          r.urgency === "High"
                            ? "text-red-500 border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400"
                            : r.urgency === "Medium"
                              ? "text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400"
                              : "text-muted-foreground border-border")}>
                          {r.urgency}
                        </Badge>
                        {r.suggested > 0 && (
                          <span className="text-xs font-semibold tabular-nums">+{r.suggested}</span>
                        )}
                      </div>
                    </div>
                    {r.daysOfStock !== null && (
                      <div className="mt-1.5 ml-10 h-1 w-[calc(100%-2.5rem)] rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all",
                            r.urgency === "High" ? "bg-red-500" : r.urgency === "Medium" ? "bg-amber-500" : "bg-blue-400"
                          )}
                          style={{ width: `${Math.min((r.daysOfStock / 14) * 100, 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="flex-1">
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center gap-2">
                <Clock size={13} className="text-muted-foreground" />
                <h3 className="text-sm font-semibold">Expiring within 30 days</h3>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-t first:border-t-0">
                    <div className="w-7 h-7 rounded-md bg-muted animate-pulse shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-muted animate-pulse rounded w-3/4" />
                      <div className="h-2.5 bg-muted animate-pulse rounded w-1/2" />
                    </div>
                    <div className="w-8 h-4 bg-muted animate-pulse rounded" />
                  </div>
                ))
              ) : !data?.expiringSoon.length ? (
                <div className="px-4 py-5 text-center text-xs text-muted-foreground">No items expiring soon</div>
              ) : (
                data.expiringSoon.map(e => (
                  <div key={e.sku} className="flex items-center gap-3 px-4 py-2.5 border-t first:border-t-0">
                    <div className="w-7 h-7 rounded-md bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center shrink-0">
                      <AlertTriangle size={12} className="text-amber-600" strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{e.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{e.sku}</div>
                    </div>
                    <span className="text-xs font-medium shrink-0">{e.units}u.</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400 shrink-0">
                      {e.days}d
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

type SyncLogRow = { current_stage: string | null; records_synced: number; status: string; store_id: string } | null;

export default function Dashboard() {
  const [showBanner, setShowBanner] = useState(true);
  const [range, setRange]           = useState<DateRangeKey>("MTD");
  const [customFrom, setCustomFrom] = useState<Date | null>(null);
  const [customTo, setCustomTo]     = useState<Date | null>(null);
  const queryClient                 = useQueryClient();
  const { stores, selectedStore }   = useStore();

  // Use the selected store's IANA timezone; fall back to browser timezone for "All Stores"
  const tz = selectedStore?.timezone
    ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const bounds = range === "Custom" && customFrom && customTo
    ? getCustomDateBounds(customFrom, customTo, tz)
    : getDateBounds(range as Exclude<DateRangeKey, "Custom">, tz);

  const { data: inventoryData } = useInventoryDashboard();
  const { data: globalKPIs }    = useSalesKPIs();

  const [syncLogs, setSyncLogs]           = useState<Record<string, SyncLogRow>>({});
  const [buttonPending, setButtonPending] = useState(false);
  const pendingTimerRef                   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didInvalidateRef                  = useRef(false);

  const isActivelySyncing = Object.values(syncLogs).some(log => log?.status === "in_progress");
  const syncing = buttonPending || isActivelySyncing;

  const invalidateAll = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["sales-kpis"] });
    await queryClient.invalidateQueries({ queryKey: ["sales-trend"] });
    await queryClient.invalidateQueries({ queryKey: ["channel-performance"] });
    await queryClient.invalidateQueries({ queryKey: ["top-products"] });
    await queryClient.invalidateQueries({ queryKey: ["collection-sales"] });
    await queryClient.invalidateQueries({ queryKey: ["inventory-dashboard"] });
  }, [queryClient]);

  useEffect(() => {
    let alive = true;

    // Fetch the latest log per store (grab enough rows to cover all stores)
    (supabase as any)
      .from("shopify_sync_logs")
      .select("current_stage, records_synced, status, store_id")
      .order("sync_time", { ascending: false })
      .limit(20)
      .then(({ data }: { data: SyncLogRow[] | null }) => {
        if (!alive) return;
        const latestPerStore: Record<string, SyncLogRow> = {};
        for (const row of data ?? []) {
          if (row?.store_id && !latestPerStore[row.store_id]) {
            latestPerStore[row.store_id] = row;
          }
        }
        setSyncLogs(latestPerStore);
      });

    const channel = (supabase as any)
      .channel("sync-progress-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shopify_sync_logs" },
        (payload: { new: SyncLogRow }) => {
          const newLog = payload.new;
          if (!alive || !newLog?.store_id) return;
          setSyncLogs(prev => ({ ...prev, [newLog.store_id]: newLog }));
        }
      )
      .subscribe();

    return () => {
      alive = false;
      (supabase as any).removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (isActivelySyncing) {
      didInvalidateRef.current = false;
      return;
    }
    const anySuccess = Object.values(syncLogs).some(
      log => log?.status === "success" || log?.current_stage === "complete"
    );
    if (anySuccess && !didInvalidateRef.current) {
      didInvalidateRef.current = true;
      invalidateAll();
    }
  }, [isActivelySyncing, syncLogs, invalidateAll]);

  useEffect(() => {
    if (buttonPending && isActivelySyncing) {
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      setButtonPending(false);
    }
  }, [buttonPending, isActivelySyncing]);

  const handleSync = useCallback(async () => {
    if (syncing) return;
    setButtonPending(true);
    didInvalidateRef.current = false;
    pendingTimerRef.current = setTimeout(() => setButtonPending(false), 20_000);
    try {
      const { data: conns } = await (supabase as any)
        .from("shopify_connections")
        .select("id")
        .eq("is_active", true);
      if (conns?.length) {
        await Promise.all(
          (conns as { id: string }[]).map(c =>
            supabase.functions.invoke("shopify-sync", {
              body: { action: "sync", connection_id: c.id },
            })
          )
        );
      }
    } catch {
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      setButtonPending(false);
    }
  }, [syncing]);

  return (
    <div className="p-6 space-y-5 max-w-[1600px]">
      {showBanner && (
        <AlertStrip
          onDismiss={() => setShowBanner(false)}
          oos={inventoryData?.kpis.outOfStock ?? null}
          winners={inventoryData?.kpis.winners ?? null}
          pendingOrders={globalKPIs?.pendingOrders ?? null}
          pendingApprovals={globalKPIs?.pendingApprovals ?? null}
        />
      )}
      {syncing && stores.length > 0 && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 dark:border-indigo-800 dark:bg-indigo-950/20 px-4 divide-y divide-indigo-100 dark:divide-indigo-900">
          {stores.map(store => (
            <SyncProgressBanner
              key={store.id}
              storeName={store.store_name}
              stage={syncLogs[store.id]?.current_stage ?? null}
              recordsSynced={syncLogs[store.id]?.records_synced ?? 0}
              status={syncLogs[store.id]?.status ?? (buttonPending ? "in_progress" : null)}
            />
          ))}
        </div>
      )}
      <SalesSection
        bounds={bounds}
        range={range}
        onRangeChange={setRange}
        onSyncStart={handleSync}
        syncing={syncing}
        customFrom={customFrom}
        customTo={customTo}
        setCustomFrom={setCustomFrom}
        setCustomTo={setCustomTo}
      />
      <div className="border-t border-dashed" />
      <InventorySection onSyncStart={handleSync} syncing={syncing} />
    </div>
  );
}