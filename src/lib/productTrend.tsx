import { TrendingUp, TrendingDown, Minus } from "lucide-react";

// Shared sales-trend classification (Product Velocity page + Product Master).
// Compares the last 7 days' pace against the 30-day pace.
export type Trend = "Spiking" | "Steady" | "Slowing" | "New";

export function getTrend(row: { units_sold_7d: number; units_sold_30d: number }): Trend {
  if (row.units_sold_30d === 0 && row.units_sold_7d === 0) return "New";
  if (row.units_sold_30d === 0) return "Spiking";
  const normalized = row.units_sold_7d * (30 / 7);
  const ratio = normalized / row.units_sold_30d;
  if (ratio > 1.3) return "Spiking";
  if (ratio < 0.7) return "Slowing";
  return "Steady";
}

export const TREND_CONFIG: Record<Trend, { label: string; cls: string; icon: React.ReactNode }> = {
  Spiking: {
    label: "Spiking",
    cls: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800",
    icon: <TrendingUp className="h-3 w-3" />,
  },
  Steady: {
    label: "Steady",
    cls: "bg-green-100 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800",
    icon: <Minus className="h-3 w-3" />,
  },
  Slowing: {
    label: "Slowing",
    cls: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800",
    icon: <TrendingDown className="h-3 w-3" />,
  },
  New: {
    label: "No Sales",
    cls: "bg-muted text-muted-foreground border-border",
    icon: <Minus className="h-3 w-3" />,
  },
};

// Same badge colours as the Dead Stock page.
export const DEAD_STOCK_CLS: Record<string, string> = {
  "Never Sold": "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/40 dark:text-slate-300",
  "Dead 90d":   "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400",
  "Dead 60d":   "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400",
  "Dead 30d":   "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400",
};
