import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRole } from "@/hooks/useRole";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Settings as SettingsIcon, Store as StoreIcon, RefreshCw, Eye } from "lucide-react";
import { useState, useEffect } from "react";
import { useStore } from "@/contexts/StoreContext";
import { format } from "date-fns";
import { usePageVisibility } from "@/hooks/usePageVisibility";

const VIEWER_PAGES = [
  { title: "Store Performance", url: "/store-performance" },
  { title: "Orders", url: "/orders" },
  { title: "Reports", url: "/reports" },
  { title: "Product Master", url: "/products" },
  { title: "Sales Campaign", url: "/manual-sync" },
  { title: "AI Co-Pilot", url: "/ai-copilot" },
  { title: "Auto-Pilot", url: "/auto-pilot" },
  { title: "Approval Queue", url: "/approvals" },
  { title: "Campaigns", url: "/campaigns" },
  { title: "Simulation", url: "/simulation" },
  { title: "Replenishment", url: "/replenishment" },
  { title: "Product Velocity", url: "/product-velocity" },
  { title: "Expiry Monitor", url: "/expiry" },
  { title: "Audit Logs", url: "/audit-logs" },
  { title: "Collection Sort", url: "/collection-sort" },
  { title: "Fulfillment", url: "/fulfillment" },
  { title: "Draft PO", url: "/draft-po" },
  { title: "Discount Performance", url: "/discount-performance" },
  { title: "Dead Stock", url: "/dead-stock" },
  { title: "Bundle Finder", url: "/bundle-finder" },
  { title: "SEO Audit", url: "/seo-audit" },
  { title: "Stores", url: "/stores" },
];

export default function Settings() {
  const { canEdit } = useRole();
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("*").eq("setting_key", "pricing_config").maybeSingle();
      return (data?.setting_value ?? {}) as Record<string, unknown>;
    },
  });

  const [form, setForm] = useState<Record<string, unknown>>({});
  useEffect(() => { if (settings) setForm(settings); }, [settings]);

  const handleSave = async () => {
    const { error } = await supabase.from("app_settings").update({ setting_value: form as unknown as import("@/integrations/supabase/types").Json }).eq("setting_key", "pricing_config");
    if (error) { toast.error("Save failed"); return; }
    toast.success("Settings saved");
    queryClient.invalidateQueries({ queryKey: ["app-settings"] });
  };

  const update = (key: string, value: unknown) => setForm(prev => ({ ...prev, [key]: value }));

  // ---- Viewer page visibility ----
  const { visibilityMap, saveVisibility } = usePageVisibility();
  const [pageViz, setPageViz] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const init: Record<string, boolean> = {};
    VIEWER_PAGES.forEach(p => { init[p.url] = visibilityMap[p.url] !== false; });
    setPageViz(init);
  }, [visibilityMap]);

  const handleSaveVisibility = async () => {
    const ok = await saveVisibility(pageViz);
    if (ok) toast.success("Page access saved");
    else toast.error("Save failed");
  };

  // ---- Shopify connection state ----
  const { selectedStoreId, selectedStore } = useStore();
  const [shopDomain, setShopDomain] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: connection, refetch: refetchConn } = useQuery({
    queryKey: ["shopify-connection", selectedStoreId],
    queryFn: async () => {
      if (!selectedStoreId) return null;
      const { data } = await supabase
        .from("shopify_connections" as never)
        .select("*")
        .eq("store_id", selectedStoreId)
        .eq("is_active", true)
        .order("connected_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as Record<string, unknown> | null;
    },
    enabled: !!selectedStoreId,
    refetchInterval: (query) =>
      (query.state.data as Record<string, unknown> | null)?.last_sync_status === "in_progress" ? 180_000 : false,
  });

  const { data: currentSyncLog } = useQuery({
    queryKey: ["shopify-sync-log", (connection as Record<string, unknown> | null)?.id],
    queryFn: async () => {
      const connId = (connection as Record<string, unknown> | null)?.id;
      if (!connId) return null;
      const { data } = await supabase
        .from("shopify_sync_logs" as never)
        .select("sync_time, status, current_stage, records_synced")
        .eq("connection_id", connId)
        .eq("status", "in_progress")
        .order("sync_time", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as { sync_time: string; status: string; current_stage: string; records_synced: number } | null;
    },
    enabled: !!(connection as Record<string, unknown> | null)?.id &&
      (connection as Record<string, unknown> | null)?.last_sync_status === "in_progress",
    refetchInterval: 180_000,
  });

  const isConnected = !!connection;

  const callShopify = async (payload: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("shopify-sync", { body: payload });
    if (error) throw new Error(error.message);
    if (data && (data as { ok?: boolean }).ok === false) {
      throw new Error((data as { error?: string }).error || "Request failed");
    }
    return data;
  };

  const handleConnect = async () => {
    if (!selectedStoreId) { toast.error("Select a store first"); return; }
    if (!shopDomain.trim() || !accessToken.trim()) { toast.error("Enter shop domain and token"); return; }
    setBusy(true);
    try {
      await callShopify({ action: "connect", shop_domain: shopDomain, access_token: accessToken, store_id: selectedStoreId });
      toast.success("Store connected — initial sync running");
      setShopDomain(""); setAccessToken("");
      await refetchConn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Connection failed");
    } finally { setBusy(false); }
  };

  const handleDisconnect = async () => {
    if (!connection) return;
    setBusy(true);
    try {
      await callShopify({ action: "disconnect", connection_id: connection.id });
      toast.success("Disconnected");
      await refetchConn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disconnect failed");
    } finally { setBusy(false); }
  };

  const handleSyncNow = async () => {
    if (!connection) return;
    setBusy(true);
    try {
      const r = await callShopify({ action: "sync", connection_id: connection.id }) as { records_synced?: number };
      toast.success(`Synced ${r?.records_synced ?? 0} records`);
      await refetchConn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally { setBusy(false); }
  };

  const handleForceResync = async () => {
    if (!connection) return;
    setBusy(true);
    try {
      await callShopify({ action: "force_resync", connection_id: connection.id });
      toast.success("Full re-sync started — this may take a few minutes");
      await refetchConn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Re-sync failed");
    } finally { setBusy(false); }
  };

  const updateConn = async (patch: Record<string, unknown>) => {
    if (!connection) return;
    const { error } = await (supabase.from("shopify_connections" as never) as unknown as { update: (p: Record<string, unknown>) => { eq: (c: string, v: string) => Promise<{ error: unknown }> } }).update(patch).eq("id", (connection as { id: string }).id);
    if (error) { toast.error("Update failed"); return; }
    await refetchConn();
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><SettingsIcon className="h-6 w-6" /> Settings</h1>
        <p className="text-sm text-muted-foreground">Configure thresholds and business rules</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Loser Classification</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Loser Threshold (Days)</Label><Input type="number" value={String(form.loser_threshold_days ?? 20)} onChange={e => update("loser_threshold_days", Number(e.target.value))} /></div>
            <div><Label>Loser Threshold (Stock)</Label><Input type="number" value={String(form.loser_threshold_stock ?? 10)} onChange={e => update("loser_threshold_stock", Number(e.target.value))} /></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Expiry & Stock</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Near-Expiry Threshold (Days)</Label><Input type="number" value={String(form.near_expiry_threshold_days ?? 30)} onChange={e => update("near_expiry_threshold_days", Number(e.target.value))} /></div>
            <div><Label>Low Stock Winner Threshold</Label><Input type="number" value={String(form.low_stock_winner_threshold ?? 15)} onChange={e => update("low_stock_winner_threshold", Number(e.target.value))} /></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Pricing Protection</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div><Label>Margin Floor (%)</Label><Input type="number" value={String(form.margin_floor_percent ?? 10)} onChange={e => update("margin_floor_percent", Number(e.target.value))} /></div>
          <div><Label>Default Rounding Mode</Label><Input value={String(form.default_rounding_mode ?? "whole")} onChange={e => update("default_rounding_mode", e.target.value)} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Workflow</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between"><Label>Require Approval Before Live Sync</Label><Switch checked={!!form.require_approval} onCheckedChange={v => update("require_approval", v)} /></div>
          <div className="flex items-center justify-between"><Label>Auto-Pilot Requires Human Review</Label><Switch checked={!!form.auto_pilot_requires_review} onCheckedChange={v => update("auto_pilot_requires_review", v)} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <StoreIcon className="h-4 w-4" /> Shopify
            {isConnected ? (
              <Badge variant="default" className="ml-2">Connected ✅</Badge>
            ) : (
              <Badge variant="secondary" className="ml-2">Not Connected ❌</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isConnected && (
            <>
              <p className="text-xs text-muted-foreground">
                Connecting for store: <span className="font-medium">{selectedStore?.store_name ?? "—"}</span>
              </p>
              <div>
                <Label>Shop Domain</Label>
                <Input placeholder="your-store.myshopify.com" value={shopDomain} onChange={e => setShopDomain(e.target.value)} />
              </div>
              <div>
                <Label>Admin API Access Token</Label>
                <Input type="password" placeholder="shpat_..." value={accessToken} onChange={e => setAccessToken(e.target.value)} />
              </div>
              <Button onClick={handleConnect} disabled={busy || !canEdit} className="w-full">
                {busy ? "Connecting..." : "Connect Store"}
              </Button>
            </>
          )}

          {isConnected && connection && (
            <>
              <div className="text-sm">
                <div><span className="text-muted-foreground">Domain:</span> {String(connection.shop_domain)}</div>
                <div><span className="text-muted-foreground">Connected:</span> {connection.connected_at ? format(new Date(connection.connected_at as string), "PPpp") : "—"}</div>
              </div>
              <Button variant="destructive" onClick={handleDisconnect} disabled={busy || !canEdit}>Disconnect</Button>

              <Separator />

              <div className="flex items-center justify-between">
                <Label>Auto Sync</Label>
                <Switch
                  checked={!!connection.auto_sync_enabled}
                  onCheckedChange={(v) => updateConn({ auto_sync_enabled: v })}
                />
              </div>
              <div>
                <Label>Frequency</Label>
                <Select
                  value={(connection.sync_frequency as string) ?? "1hr"}
                  onValueChange={(v) => updateConn({ sync_frequency: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15min">Every 15 minutes</SelectItem>
                    <SelectItem value="30min">Every 30 minutes</SelectItem>
                    <SelectItem value="1hr">Every 1 hour</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2">
                <Button onClick={handleSyncNow} disabled={busy || !canEdit} className="flex-1">
                  <RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} />
                  Sync Now
                </Button>
                <Button onClick={handleForceResync} disabled={busy || !canEdit} variant="outline" className="flex-1">
                  <RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} />
                  Force Full Re-sync
                </Button>
              </div>

              <div className="text-xs text-muted-foreground border-t pt-3 space-y-1">
                {connection.last_sync_status === "in_progress" ? (
                  <>
                    <div>
                      <span className="text-muted-foreground">Sync started: </span>
                      {currentSyncLog?.sync_time
                        ? format(new Date(currentSyncLog.sync_time), "PPpp")
                        : "just now"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Stage: </span>
                      {currentSyncLog?.current_stage ?? "—"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Records so far: </span>
                      {currentSyncLog?.records_synced ?? 0}
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <span className="text-muted-foreground">Last sync completed: </span>
                      {connection.last_sync_at ? format(new Date(connection.last_sync_at as string), "PPpp") : "Never"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Status: </span>
                      {(connection.last_sync_status as string) ?? "—"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Records synced: </span>
                      {(connection.last_sync_records as number) ?? 0}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="h-4 w-4" /> Viewer Page Access
          </CardTitle>
          <p className="text-xs text-muted-foreground">Toggle which pages viewers can see. Dashboard is always visible.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {VIEWER_PAGES.map(page => (
            <div key={page.url} className="flex items-center justify-between">
              <Label className="font-normal">{page.title}</Label>
              <Switch
                checked={pageViz[page.url] !== false}
                onCheckedChange={v => setPageViz(prev => ({ ...prev, [page.url]: v }))}
                disabled={!canEdit}
              />
            </div>
          ))}
          <Button onClick={handleSaveVisibility} className="w-full mt-2" disabled={!canEdit}>
            Save Page Access
          </Button>
        </CardContent>
      </Card>

      <Button onClick={handleSave} className="w-full" disabled={!canEdit}>Save Settings</Button>
    </div>
  );
}
