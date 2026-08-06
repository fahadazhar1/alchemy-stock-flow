import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/contexts/StoreContext";
import { useRole } from "@/hooks/useRole";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Gift, Loader2, TrendingUp } from "lucide-react";

interface Settings {
  enabled: boolean;
  percentage: number;
  showDeadstock: boolean;
  shardCount: number;
}

interface Stats {
  days: number;
  ordersScanned: number;
  matchingOrders: number;
  totalDiscountGiven: number;
  totalRevenue: number;
}

export default function FbtBundleSettings() {
  const { selectedStore } = useStore();
  const { canEdit } = useRole();
  const queryClient = useQueryClient();
  const storeId = selectedStore?.id ?? null;
  const currencySymbol = selectedStore?.currency_symbol ?? "£";

  const [enabled, setEnabled] = useState(true);
  const [percentage, setPercentage] = useState(10);
  const [showDeadstock, setShowDeadstock] = useState(true);
  const [dirty, setDirty] = useState(false);

  async function resolveConnectionId(): Promise<string> {
    if (!storeId) throw new Error("Select a specific store first");
    const { data: conn, error } = await supabase
      .from("shopify_connections")
      .select("id")
      .eq("store_id", storeId)
      .eq("is_active", true)
      .single();
    if (error || !conn) throw new Error("No active Shopify connection for this store");
    return conn.id as string;
  }

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["fbt-bundle-settings", storeId],
    queryFn: async () => {
      const connectionId = await resolveConnectionId();
      const { data, error } = await supabase.functions.invoke("fbt-bundle-settings", {
        body: { action: "get_settings", connection_id: connectionId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Failed to load settings");
      return data as Settings;
    },
    enabled: !!storeId,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (settings) {
      setEnabled(settings.enabled);
      setPercentage(settings.percentage);
      setShowDeadstock(settings.showDeadstock);
      setDirty(false);
    }
  }, [settings]);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["fbt-bundle-stats", storeId],
    queryFn: async () => {
      const connectionId = await resolveConnectionId();
      const { data, error } = await supabase.functions.invoke("fbt-bundle-settings", {
        body: { action: "get_stats", connection_id: connectionId, days: 90 },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Failed to load stats");
      return data as Stats;
    },
    enabled: !!storeId,
    staleTime: 5 * 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const connectionId = await resolveConnectionId();
      const { data, error } = await supabase.functions.invoke("fbt-bundle-settings", {
        body: { action: "update_settings", connection_id: connectionId, enabled, percentage, showDeadstock },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Save failed");
      return data;
    },
    onSuccess: () => {
      toast.success("Bundle discount settings saved — live immediately");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["fbt-bundle-settings", storeId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!storeId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6 text-muted-foreground">
            Select a specific store above to manage its Frequently Bought Together bundle discount.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Gift className="h-6 w-6" /> Frequently Bought Together — Bundle Discount
        </h1>
        <p className="text-muted-foreground mt-1">
          A real checkout discount that applies only when a customer buys the exact set of items shown
          in a product's "Frequently Bought Together" widget — not just any 3 items.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Discount</CardTitle>
          <CardDescription>
            {settings?.shardCount
              ? `Currently applied across ${settings.shardCount} discount rule${settings.shardCount === 1 ? "" : "s"} covering every eligible product on this store.`
              : "Loading current setup..."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {settingsLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="fbt-enabled" className="text-base">Enable bundle discount</Label>
                  <p className="text-sm text-muted-foreground">Turn the discount off without losing your percentage or trio data.</p>
                </div>
                <Switch
                  id="fbt-enabled"
                  checked={enabled}
                  disabled={!canEdit}
                  onCheckedChange={(v) => { setEnabled(v); setDirty(true); }}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base">Discount percentage</Label>
                  <span className="text-lg font-semibold tabular-nums">{percentage}%</span>
                </div>
                <Slider
                  value={[percentage]}
                  min={0}
                  max={30}
                  step={1}
                  disabled={!canEdit || !enabled}
                  onValueChange={([v]) => { setPercentage(v); setDirty(true); }}
                />
              </div>

              <div className="flex items-center justify-between border-t pt-6">
                <div>
                  <Label htmlFor="fbt-deadstock" className="text-base">Show dead-stock filler item</Label>
                  <p className="text-sm text-muted-foreground">
                    When a product has fewer than 2 real bought-together partners, pad the widget with a
                    dead-stock pick (clearly not part of the discount). Turn off to only ever show real pairs.
                  </p>
                </div>
                <Switch
                  id="fbt-deadstock"
                  checked={showDeadstock}
                  disabled={!canEdit}
                  onCheckedChange={(v) => { setShowDeadstock(v); setDirty(true); }}
                />
              </div>

              {canEdit && (
                <div className="flex justify-end pt-2">
                  <Button onClick={() => saveMutation.mutate()} disabled={!dirty || saveMutation.isPending}>
                    {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Save
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" /> Usage (last 90 days)</CardTitle>
          <CardDescription>How many customers actually used the bundle discount.</CardDescription>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : stats ? (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-2xl font-semibold tabular-nums">{stats.matchingOrders}</div>
                <div className="text-sm text-muted-foreground">Orders with bundle discount</div>
              </div>
              <div>
                <div className="text-2xl font-semibold tabular-nums">{currencySymbol}{stats.totalDiscountGiven.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Total discount given</div>
              </div>
              <div>
                <div className="text-2xl font-semibold tabular-nums">{currencySymbol}{stats.totalRevenue.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Revenue from those orders</div>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">No data.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
