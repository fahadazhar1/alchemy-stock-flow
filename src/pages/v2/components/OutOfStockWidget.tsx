import { useState, useMemo } from "react";
import { XCircle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtGBP, fmtNum } from "../mockData";
import { useOutOfStockLast7Days, type OosProduct } from "@/hooks/useOutOfStockLast7Days";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function OosRowSkeleton() {
  return (
    <tr className="border-b last:border-b-0">
      {[80, 40, 45, 55, 55, 45, 30].map((w, i) => (
        <td key={i} className="px-4 py-2.5">
          <div className="h-3 bg-muted animate-pulse rounded" style={{ width: `${w}%` }} />
        </td>
      ))}
    </tr>
  );
}

// ─── OOS badge ───────────────────────────────────────────────────────────────

const OOS_BADGE = (
  <Badge variant="outline"
    className="text-[10px] px-1.5 py-0 text-red-500 border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400">
    OOS
  </Badge>
);

// ─── Table ───────────────────────────────────────────────────────────────────

const HEADERS = ["Product", "Price", "Sold 7d", "Revenue 7d", "Est. loss/day", "Last sold", "Current"];

function OosTable({ rows }: { rows: OosProduct[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b">
          {HEADERS.map((h, i) => (
            <th key={i} className={cn(
              "px-4 py-2 font-medium text-muted-foreground text-left",
              i >= 1 && "text-right",
            )}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.product_id} className="border-b last:border-b-0 hover:bg-muted/40 transition-colors">
            <td className="px-4 py-2.5">
              <div className="font-medium truncate max-w-[180px]">{r.name}</div>
              <div className="font-mono text-[10px] text-muted-foreground">{r.sku}</div>
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums">{fmtGBP(r.price)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums">{fmtNum(r.unitsSold7d)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums font-medium">{fmtGBP(r.revenue7d)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-red-600 dark:text-red-400 font-medium">
              {fmtGBP(r.estimatedLostRevenuePerDay)}
            </td>
            <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{fmtDate(r.lastSoldAt)}</td>
            <td className="px-4 py-2.5 text-right">{OOS_BADGE}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Widget ──────────────────────────────────────────────────────────────────

export function OutOfStockWidget() {
  const { data, isLoading } = useOutOfStockLast7Days();
  const [open, setOpen] = useState(false);

  const preview = useMemo(() => (data ?? []).slice(0, 7), [data]);
  const total   = data?.length ?? 0;

  return (
    <>
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <XCircle size={14} className="text-red-500" />
              <h3 className="text-sm font-semibold">Out of stock</h3>
              <span className="text-xs text-muted-foreground">best sellers, last 7 days</span>
              {!isLoading && total > 0 && (
                <Badge variant="outline"
                  className="text-[10px] px-1.5 py-0 text-red-500 border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400">
                  {total}
                </Badge>
              )}
            </div>
            {total > 7 && (
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => setOpen(true)}>
                View all {total}
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <table className="w-full text-xs">
              <tbody>{Array.from({ length: 5 }).map((_, i) => <OosRowSkeleton key={i} />)}</tbody>
            </table>
          ) : !preview.length ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              No recently sold products are currently out of stock.
            </div>
          ) : (
            <OosTable rows={preview} />
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle size={16} className="text-red-500" />
              Out of stock — best sellers, last 7 days
              <Badge variant="outline"
                className="text-[10px] px-1.5 py-0 text-red-500 border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400 ml-1">
                {total}
              </Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 rounded-md border overflow-hidden">
            <OosTable rows={data ?? []} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
