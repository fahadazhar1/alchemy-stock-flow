import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { exportToCSV } from "@/lib/export";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowRight, ArrowLeftRight, Download } from "lucide-react";

type Suggestion = {
  store_id: string;
  product_id: string;
  variant_id: string;
  product_name: string;
  variant_title: string | null;
  variant_count: number;
  sku: string;
  to_location_id: string;
  to_location: string;
  to_available: number;
  to_sold_30d: number;
  to_days_cover: number;
  from_location_id: string;
  from_location: string;
  from_available: number;
  from_sold_30d: number;
  suggested_qty: number;
  urgency: "Critical" | "Soon" | "Plan";
};

const URGENCY_CLS: Record<Suggestion["urgency"], string> = {
  Critical: "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800",
  Soon: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800",
  Plan: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800",
};

// Inter-location transfers that would fix a low-stock location from another location's surplus,
// before raising a purchase order. Shown only when the store has more than one location.
export function TransferSuggestions({ storeId }: { storeId: string | null }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [active, setActive] = useState<Suggestion | null>(null);
  const [qty, setQty] = useState("");
  const [moving, setMoving] = useState(false);

  const { data } = useQuery({
    queryKey: ["transfer-suggestions", storeId],
    staleTime: 3 * 60 * 1000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("get_transfer_suggestions", { p_store_id: storeId });
      if (error) throw error;
      return (data ?? []) as Suggestion[];
    },
  });

  if (!data?.length) return (
    <div className="text-center py-16 text-muted-foreground">
      <ArrowLeftRight className="h-10 w-10 mx-auto mb-2 opacity-40" />
      <p className="font-medium">No transfers needed</p>
      <p className="text-xs mt-1">Every location has enough stock for what it sells, or no other location has spare</p>
    </div>
  );

  const open = (s: Suggestion) => { setActive(s); setQty(String(s.suggested_qty)); };

  const confirm = async () => {
    if (!active) return;
    const n = Math.floor(Number(qty));
    if (!(n > 0) || n > active.from_available) {
      toast.error(`Enter 1 to ${active.from_available} units`);
      return;
    }
    setMoving(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("shopify-sync", {
        body: {
          action: "transfer_inventory",
          store_id: active.store_id,
          variant_id: active.variant_id,
          from_location_id: active.from_location_id,
          to_location_id: active.to_location_id,
          quantity: n,
          adjusted_by: user?.email ?? null,
        },
      });
      if (error || !res?.ok) throw new Error(res?.error || error?.message || "Transfer failed");
      toast.success(`Moved ${n} × ${active.product_name} from ${active.from_location} to ${active.to_location}`);
      setActive(null);
      queryClient.invalidateQueries({ queryKey: ["transfer-suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["product-master-signals"] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Transfer failed");
    } finally {
      setMoving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4" /> Transfer before you reorder
            <Badge variant="secondary" className="text-[11px]">{data.length}</Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            A location is running low on something another location has more than 30 days of. Sales per location = units fulfilled from it in the last 30 days.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => exportToCSV(
          data.map(s => ({
            Product: s.product_name,
            Variant: s.variant_count > 1 ? s.variant_title ?? "" : "",
            SKU: s.sku,
            "Move Qty": s.suggested_qty,
            From: s.from_location,
            "From Stock": s.from_available,
            "From Sold 30d": s.from_sold_30d,
            To: s.to_location,
            "To Stock": s.to_available,
            "To Sold 30d": s.to_sold_30d,
            "To Days Cover": s.to_days_cover,
            Urgency: s.urgency,
          })),
          "transfer-suggestions"
        )}>
          <Download className="h-4 w-4 mr-1" /> Export
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.map(s => (
          <div key={`${s.variant_id}-${s.to_location_id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-3">
            <Badge variant="outline" className={cn("text-[11px] shrink-0", URGENCY_CLS[s.urgency])}>{s.urgency}</Badge>
            <div className="min-w-0 flex-1 basis-56">
              <div className="font-medium text-sm leading-snug line-clamp-1">{s.product_name}</div>
              <div className="flex items-center gap-2 mt-0.5">
                {s.variant_count > 1 && s.variant_title && <Badge variant="secondary" className="text-[10px]">{s.variant_title}</Badge>}
                <span className="font-mono text-[11px] text-muted-foreground">{s.sku}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <div className="text-right">
                <div className="font-medium">{s.from_location}</div>
                <div className="text-muted-foreground tabular-nums">{s.from_available} in stock · {s.from_sold_30d} sold</div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <div className="font-medium">{s.to_location}</div>
                <div className="text-muted-foreground tabular-nums">{s.to_available} in stock · {s.to_sold_30d} sold · {s.to_days_cover}d left</div>
              </div>
            </div>
            <Button size="sm" onClick={() => open(s)}>Transfer {s.suggested_qty}</Button>
          </div>
        ))}
      </CardContent>

      <Dialog open={!!active} onOpenChange={o => { if (!o && !moving) setActive(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer stock</DialogTitle>
            <DialogDescription>
              This changes live Shopify stock: units leave {active?.from_location} and arrive at {active?.to_location} in one step. Make sure the books are physically moved too.
            </DialogDescription>
          </DialogHeader>
          {active && (
            <div className="space-y-3">
              <div className="text-sm font-medium">
                {active.product_name}{active.variant_count > 1 && active.variant_title ? ` — ${active.variant_title}` : ""}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="transfer-qty">Units to move (max {active.from_available})</Label>
                <Input id="transfer-qty" type="number" min={1} max={active.from_available} value={qty} onChange={e => setQty(e.target.value)} disabled={moving} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActive(null)} disabled={moving}>Cancel</Button>
            <Button onClick={confirm} disabled={moving}>{moving ? "Moving…" : "Confirm transfer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
