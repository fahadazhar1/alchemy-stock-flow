import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Package, ShoppingCart, TrendingUp, AlertTriangle, Users, Layers, Award, XCircle, Clock, ArrowDown, BarChart3, CheckSquare, DollarSign, Download, Eye, Warehouse, RefreshCw } from "lucide-react";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip as TooltipUI, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/timezone";
import { exportToCSV } from "@/lib/export";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { DateRangeFilter, matchesDateFilter } from "@/components/DateRangeFilter";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import { useCentralInventoryKPIs } from "@/hooks/useCentralInventory";
import { Progress } from "@/components/ui/progress";

const STAGE_ORDER = ["products", "collections", "orders", "inventory", "complete"];

function useKPIs(storeId: string | null) {
  return useQuery({
    queryKey: ["dashboard-kpis", storeId],
    queryFn: async () => {
      try {
        // Fetch global KPIs from the view
        const { data: viewData, error: viewError } = await supabase.from("v_dashboard_kpis").select("*").single();
        if (viewError) throw viewError;

        // Count orders that are: paid, open (not cancelled), and not yet fulfilled
        let pendingQuery = supabase
          .from("orders")
          .select("*", { count: "exact", head: true })
          .eq("financial_status", "paid")
          .or("order_status.eq.open,order_status.is.null")
          .or("fulfillment_status.is.null,fulfillment_status.eq.partial");

        if (storeId) pendingQuery = (pendingQuery as any).eq("store_id", storeId);

        const { count: pendingCount, error: pendingErr } = await (pendingQuery as any);

        if (!pendingErr) {
          return { ...viewData, pending_order_inventory: pendingCount ?? 0 };
        }

        return viewData;
      } catch (e) {
        console.error("Failed to fetch KPIs", e);
        return null;
      }
    },
  });
}

function useStockValue(storeId: string | null) {
  return useQuery({
    queryKey: ["total-stock-value", storeId],
    queryFn: async () => {
      let q = supabase.from("variants").select("inventory_quantity, price");
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).reduce((sum, v) => sum + v.inventory_quantity * Number(v.price), 0);
    },
  });
}

function useSellThrough(storeId: string | null) {
  return useQuery({
    queryKey: ["sell-through-corrected", storeId],
    queryFn: async () => {
      const now = new Date();
      const uaeNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Dubai" }));
      const startOfMonth = new Date(uaeNow.getFullYear(), uaeNow.getMonth(), 1);
      const startISO = startOfMonth.toISOString();
      let oiQ = supabase
        .from("order_items")
        .select("quantity, order_id, orders!inner(status, created_at)")
        .gte("orders.created_at", startISO)
        .filter("orders.status", "in", '("paid","fulfilled")');
      if (storeId) oiQ = oiQ.eq("store_id", storeId);
      const { data: orderItems, error: oiErr } = await oiQ;
      if (oiErr) throw oiErr;
      const unitsSold = (orderItems ?? []).reduce((s, oi) => s + oi.quantity, 0);
      let invQ = supabase.from("variants").select("inventory_quantity");
      if (storeId) invQ = invQ.eq("store_id", storeId);
      const { data: inv, error: invErr } = await invQ;
      if (invErr) throw invErr;
      const currentInventory = (inv ?? []).reduce((s, v) => s + v.inventory_quantity, 0);
      const openingInventory = currentInventory + unitsSold;
      const ratio = openingInventory > 0 ? Math.round((unitsSold / openingInventory) * 1000) / 10 : 0;
      return { ratio, unitsSold, openingInventory, currentInventory };
    },
  });
}

function useAllLosers(storeId: string | null) {
  return useQuery({
    queryKey: ["all-losers", storeId],
    queryFn: async () => {
      // v_loser_products is a view joining products - need to filter by store_id via products
      // Since the view doesn't have store_id, we join manually
      let q = supabase.from("v_loser_products").select("*").order("days_old", { ascending: false });
      // Can't filter view by store_id directly; we'll do client-side with product lookup
      const { data, error } = await q;
      if (error) throw error;
      if (!storeId) return data ?? [];
      // Get product_ids for this store
      const { data: storeProducts } = await supabase.from("products").select("id").eq("store_id", storeId);
      const storeProductIds = new Set((storeProducts ?? []).map(p => p.id));
      return (data ?? []).filter(l => l.product_id && storeProductIds.has(l.product_id));
    },
  });
}

function useInventoryActuals(storeId: string | null) {
  return useQuery({
    queryKey: ["inventory-actuals", storeId],
    queryFn: async () => {
      let q = supabase
        .from("v_product_inventory_summary")
        .select("product_id, collection_name, vendor_name, product_type, total_inventory, created_at, min_current_price, max_compare_at_price");
      // View doesn't have store_id, filter by product_ids
      const { data, error } = await q;
      if (error) throw error;
      if (!storeId) return data ?? [];
      const { data: storeProducts } = await supabase.from("products").select("id").eq("store_id", storeId);
      const storeProductIds = new Set((storeProducts ?? []).map(p => p.id));
      return (data ?? []).filter(r => r.product_id && storeProductIds.has(r.product_id));
    },
  });
}

function useCampaignTrend(storeId: string | null) {
  return useQuery({
    queryKey: ["campaign-trend", storeId],
    queryFn: async () => {
      let q = supabase
        .from("pricing_campaigns")
        .select("name, discount_percent, started_at, workflow_status")
        .not("started_at", "is", null)
        .order("started_at", { ascending: true })
        .limit(20);
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map(c => ({
        name: c.name?.substring(0, 15) || "?",
        discount: Number(c.discount_percent || 0),
        status: c.workflow_status,
        started_at: c.started_at,
      }));
    },
  });
}

const CHART_COLORS = [
  "hsl(225, 70%, 50%)", "hsl(160, 60%, 45%)", "hsl(35, 90%, 55%)",
  "hsl(280, 60%, 55%)", "hsl(0, 72%, 51%)", "hsl(190, 70%, 45%)",
  "hsl(45, 80%, 50%)", "hsl(320, 60%, 50%)",
];

function KPICard({ title, value, icon: Icon, color, subtitle }: { title: string; value: string | number; icon: React.ElementType; color: string; subtitle?: string }) {
  return (
    <Card className="transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{typeof value === 'number' ? value.toLocaleString() : value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <div className="p-2 rounded-lg bg-muted">
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

type SyncMetadata = {
  heartbeat_at?: string;
  status_message?: string;
};

function useSyncHealth(storeId: string | null) {
  return useQuery({
    queryKey: ["sync-health", storeId],
    queryFn: async () => {
      if (!storeId) return null;
      const { data: connection } = await supabase
        .from("shopify_connections" as never)
        .select("id, last_sync_status, last_sync_at")
        .eq("store_id", storeId)
        .eq("is_active", true)
        .order("connected_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!connection) return null;

      const { data: latestLog } = await supabase
        .from("shopify_sync_logs" as never)
        .select("status, current_stage, metadata, error_message, current_page, records_synced, sync_time")
        .eq("connection_id", (connection as any).id)
        .order("sync_time", { ascending: false })
        .limit(1)
        .maybeSingle();

      return {
        status: (connection as any).last_sync_status as string,
        lastSyncAt: (connection as any).last_sync_at as string,
        connectionId: (connection as any).id as string,
        latestLog: latestLog as any
      };
    },
    enabled: !!storeId,
    refetchInterval: 15000, // Refresh health status every 15 seconds
  });
}

function SyncHealthBadge({ storeId }: { storeId: string | null }) {
  const { data: health, refetch } = useSyncHealth(storeId);
  const [syncing, setSyncing] = useState(false);

  if (!storeId || !health) return null;

  const isSyncing = health.status === "in_progress" || syncing;
  const isFailed = health.status === "failed" || health.latestLog?.status === "failed";
  
  // Detect stalled syncs using heartbeat or start time (5 minute threshold)
  const metadata = (health.latestLog?.metadata ?? {}) as SyncMetadata;
  const lastActiveTime = metadata.heartbeat_at 
    ? new Date(metadata.heartbeat_at).getTime() 
    : (health.latestLog?.sync_time ? new Date(health.latestLog.sync_time).getTime() : null);
  const isStale = isSyncing && lastActiveTime && (Date.now() - lastActiveTime) > 300000;

  const stageIndex = STAGE_ORDER.indexOf(String(health.latestLog?.current_stage ?? "products"));
  const progressValue = Math.min(100, ((stageIndex + 1) / STAGE_ORDER.length) * 100);

  const handleSyncNow = async () => {
    if (!health.connectionId) return;
    setSyncing(true);
    try {
      await supabase.functions.invoke("shopify-sync", {
        body: { action: "sync", connection_id: health.connectionId }
      });
      toast.success("Sync started from dashboard");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const badgeContent = (() => {
    if (isStale) {
      return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 gap-1 animate-pulse"><AlertTriangle className="h-3 w-3" /> Sync Stalled</Badge>;
    }
    if (isSyncing) {
      return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 gap-1"><RefreshCw className="h-3 w-3 animate-spin" /> Syncing</Badge>;
    }
    if (isFailed) {
      return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Sync Failed</Badge>;
    }
    return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1"><CheckSquare className="h-3 w-3" /> System Healthy</Badge>;
  })();

  return (
    <div className="flex flex-col gap-1.5 items-start">
      <div className="flex items-center gap-2">
        <TooltipProvider>
          <TooltipUI>
            <TooltipTrigger asChild>
              <span className="cursor-help">
                {badgeContent}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">
                Last sync: {health.lastSyncAt ? format(new Date(health.lastSyncAt), "PPpp") : "Never"}
              </p>
            </TooltipContent>
          </TooltipUI>
        </TooltipProvider>

      {(!isSyncing || isStale) && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-7 px-2 text-[10px] gap-1 text-muted-foreground hover:text-foreground" 
            onClick={handleSyncNow}
            disabled={syncing}
          >
          <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} /> 
          {isStale ? "Restart Stalled Sync" : "Sync Now"}
          </Button>
        )}
      </div>

      {/* Sync Progress Bar */}
      {isSyncing && health.latestLog && (
        <div className="w-48 space-y-1">
          <Progress value={progressValue} className="h-1" />
          <div className="flex justify-between text-[9px] text-muted-foreground uppercase tracking-wider font-medium">
            <span>{String(health.latestLog.current_stage || 'syncing')}</span>
            <span>{Number(health.latestLog.records_synced || 0)} items</span>
          </div>
        </div>
      )}

      {/* Last Sync Errors */}
      {isFailed && health.latestLog?.error_message && (
        <div className="bg-destructive/10 text-destructive text-[10px] p-2 rounded border border-destructive/20 max-w-[280px]">
          <p className="font-bold flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Last Sync Error:</p>
          <p className="mt-0.5 line-clamp-2 leading-relaxed">{health.latestLog.error_message}</p>
        </div>
      )}

      {/* Stalled Warning */}
      {isStale && (
        <div className="bg-amber-50 text-amber-700 text-[10px] p-2 rounded border border-amber-200 max-w-[280px]">
          <p className="font-bold flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Sync Stalled:</p>
          <p className="mt-0.5 leading-relaxed">No activity for &gt; 5 mins. This can happen if the process crashes or times out. Try restarting the sync.</p>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { storeId, isAllStores } = useStoreFilter();
  const { data: kpis, isLoading } = useKPIs(storeId);
  const { data: stockValue } = useStockValue(storeId);
  const { data: sellThrough } = useSellThrough(storeId);
  const { data: allLosers } = useAllLosers(storeId);
  const { data: rawActuals } = useInventoryActuals(storeId);
  const { data: campaignTrend } = useCampaignTrend(storeId);
  const { data: centralKPIs } = useCentralInventoryKPIs();
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [losersModalOpen, setLosersModalOpen] = useState(false);
  const [loserPage, setLoserPage] = useState(0);

  const [filterDates, setFilterDates] = useState<Date[]>([]);
  const [filterMonths, setFilterMonths] = useState<number[]>([]);
  const [filterYears, setFilterYears] = useState<number[]>([]);
  const hasDateFilter = filterDates.length > 0 || filterMonths.length > 0 || filterYears.length > 0;
  const resetDateFilter = () => { setFilterDates([]); setFilterMonths([]); setFilterYears([]); };

  const filteredActuals = useMemo(() => {
    if (!rawActuals) return [];
    if (!hasDateFilter) return rawActuals;
    return rawActuals.filter(r => matchesDateFilter(r.created_at, filterDates, filterMonths, filterYears));
  }, [rawActuals, filterDates, filterMonths, filterYears, hasDateFilter]);

  const actuals = useMemo(() => {
    const byCollection: Record<string, number> = {};
    const byVendor: Record<string, number> = {};
    const byType: Record<string, number> = {};
    filteredActuals.forEach(r => {
      const cn = r.collection_name || "Uncategorized";
      const vn = r.vendor_name || "Unknown";
      const pt = r.product_type || "Other";
      byCollection[cn] = (byCollection[cn] || 0) + (r.total_inventory || 0);
      byVendor[vn] = (byVendor[vn] || 0) + (r.total_inventory || 0);
      byType[pt] = (byType[pt] || 0) + (r.total_inventory || 0);
    });
    return { byCollection, byVendor, byType };
  }, [filteredActuals]);

  const filteredLosers = useMemo(() => {
    if (!allLosers) return [];
    return allLosers;
  }, [allLosers]);

  const displayLosers = filteredLosers.slice(loserPage * 10, (loserPage + 1) * 10);
  const totalLoserPages = Math.ceil(filteredLosers.length / 10);

  const filteredCampaignTrend = useMemo(() => {
    if (!campaignTrend) return [];
    if (!hasDateFilter) return campaignTrend;
    return campaignTrend.filter(c => matchesDateFilter(c.started_at, filterDates, filterMonths, filterYears));
  }, [campaignTrend, filterDates, filterMonths, filterYears, hasDateFilter]);

  const losersForModal = useMemo(() => {
    if (!allLosers || !rawActuals) return [];
    const priceMap = new Map<string, { price: number | null; compareAt: number | null }>();
    rawActuals.forEach(r => {
      if (r.product_id) priceMap.set(r.product_id, { price: r.min_current_price, compareAt: r.max_compare_at_price });
    });
    return filteredLosers.map(l => ({
      ...l,
      current_price: priceMap.get(l.product_id!)?.price ?? null,
      compare_at_price: priceMap.get(l.product_id!)?.compareAt ?? null,
    }));
  }, [allLosers, rawActuals, filteredLosers]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 14 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  if (!kpis) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <AlertTriangle className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p>Failed to load dashboard data. Please refresh the page.</p>
        </CardContent></Card>
      </div>
    );
  }

  const k = kpis;
  const sellThroughValue = sellThrough?.ratio ?? k.sell_through_ratio_current_month ?? 0;

  const winnersLosersData = [
    { name: "Winners", value: k.winners_count ?? 0 },
    { name: "Losers", value: k.losers_count ?? 0 },
  ];

  const inventoryByType = actuals?.byType
    ? Object.entries(actuals.byType).sort(([, a], [, b]) => b - a).slice(0, 8).map(([name, value]) => ({ name, value }))
    : [];

  const handleExportLosers = () => {
    if (!losersForModal.length) return;
    exportToCSV(losersForModal.map(l => ({
      Name: l.product_name, SKU: l.sku, Collection: l.collection_name,
      "Current Price": l.current_price ?? "", "Compare At Price": l.compare_at_price ?? "",
      "Days Old": l.days_old, "Stock Quantity": l.total_inventory, Vendor: l.vendor_name,
    })), "losers-export");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <SyncHealthBadge storeId={storeId} />
          </div>
          <p className="text-sm text-muted-foreground">Real-time inventory & pricing command center</p>
        </div>
        <DateRangeFilter
          selectedDates={filterDates} selectedMonths={filterMonths} selectedYears={filterYears}
          onDatesChange={setFilterDates} onMonthsChange={setFilterMonths} onYearsChange={setFilterYears}
          onReset={resetDateFilter}
        />
      </div>

      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Operational KPIs</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <KPICard title="On-Hand Inventory" value={k.on_hand_inventory ?? 0} icon={Package} color="text-primary" subtitle="Total units in stock" />
          <KPICard title="Total Stock Value" value={stockValue != null ? formatCurrency(stockValue) : "—"} icon={DollarSign} color="text-emerald-600" subtitle="At current prices" />
          <KPICard title="Available Units" value={k.available_units ?? 0} icon={ShoppingCart} color="text-primary" subtitle="Sellable inventory" />
          <KPICard title="Pending Orders" value={k.pending_order_inventory ?? 0} icon={Clock} color="text-amber-600" subtitle="Awaiting fulfillment" />
          <KPICard title="Sell-Through %" value={`${sellThroughValue}%`} icon={TrendingUp} color="text-violet-600" subtitle="Current month (corrected)" />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Business Health</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <KPICard title="Out of Stock" value={k.out_of_stock_products ?? 0} icon={XCircle} color="text-orange-600" />
          <KPICard title="Losers" value={k.losers_count ?? 0} icon={ArrowDown} color="text-destructive" subtitle=">20 days, >10 stock" />
          <KPICard title="Winners" value={k.winners_count ?? 0} icon={Award} color="text-emerald-600" />
          <KPICard title="Collections" value={k.collections_count ?? 0} icon={Layers} color="text-primary" />
          <KPICard title="Vendors" value={k.vendors_count ?? 0} icon={Users} color="text-primary" />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Action Items</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KPICard title="Near Expiry" value={k.near_expiry_products_count ?? 0} icon={AlertTriangle} color="text-amber-600" />
          <KPICard title="Low Stock Winners" value={k.low_stock_winners_count ?? 0} icon={TrendingUp} color="text-emerald-600" />
          <KPICard title="Campaigns Running" value={k.campaigns_running_count ?? 0} icon={BarChart3} color="text-primary" />
          <KPICard title="Pending Approvals" value={k.pending_approvals_count ?? 0} icon={CheckSquare} color="text-violet-600" />
        </div>
      </div>

      {/* Central WMS Inventory */}
      {centralKPIs && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1"><Warehouse className="h-3 w-3" /> Central WMS Inventory</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <KPICard title="Central SKUs" value={centralKPIs.totalSKUs} icon={Package} color="text-primary" subtitle="Master variants" />
            <KPICard title="Master Products" value={centralKPIs.uniqueProducts} icon={Layers} color="text-primary" />
            <KPICard title="Total Available" value={centralKPIs.totalAvailable} icon={ShoppingCart} color="text-emerald-600" subtitle="Central pool" />
            <KPICard title="Reserved" value={centralKPIs.totalReserved} icon={Clock} color="text-amber-600" />
            <KPICard title="Net Available" value={centralKPIs.totalNetAvailable} icon={TrendingUp} color="text-violet-600" />
            <KPICard title="Central Value" value={formatCurrency(centralKPIs.totalValue)} icon={DollarSign} color="text-emerald-600" subtitle="At base prices" />
          </div>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="transition-all hover:shadow-md">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Inventory by Category</CardTitle></CardHeader>
          <CardContent>
            {inventoryByType.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={inventoryByType} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => v.toLocaleString()} />
                  <Bar dataKey="value" fill="hsl(225, 70%, 50%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-center text-muted-foreground text-sm py-12">No data</p>}
          </CardContent>
        </Card>

        <Card className="transition-all hover:shadow-md">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Winners vs Losers</CardTitle></CardHeader>
          <CardContent className="flex items-center justify-center">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={winnersLosersData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  <Cell fill="hsl(160, 60%, 45%)" />
                  <Cell fill="hsl(0, 72%, 51%)" />
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="transition-all hover:shadow-md">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Campaign Discount Trend</CardTitle></CardHeader>
          <CardContent>
            {filteredCampaignTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={filteredCampaignTrend} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-30} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="discount" stroke="hsl(280, 60%, 55%)" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="text-center text-muted-foreground text-sm py-12">No campaigns</p>}
          </CardContent>
        </Card>
      </div>

      {/* Inventory Actuals */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Inventory Actuals</CardTitle>
          <p className="text-xs text-muted-foreground">Category-level inventory breakdown</p>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4">
            {["byCollection", "byVendor", "byType"].map(key => (
              <Button key={key} variant={expandedSection === key ? "default" : "outline"} size="sm"
                onClick={() => setExpandedSection(expandedSection === key ? null : key)}>
                {key === "byCollection" ? "By Collection" : key === "byVendor" ? "By Vendor" : "By Type"}
              </Button>
            ))}
          </div>
          {expandedSection && actuals && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(actuals[expandedSection as keyof typeof actuals])
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .map(([name, qty]) => (
                  <div key={name} className="flex justify-between items-center p-2 bg-muted rounded text-sm transition-colors hover:bg-accent">
                    <span className="truncate">{name}</span>
                    <span className="font-mono font-medium">{(qty as number).toLocaleString()}</span>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Losers Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <ArrowDown className="h-5 w-5 text-destructive" /> Shelf Life of Losers
              </CardTitle>
              <p className="text-xs text-muted-foreground">Products older than 20 days with stock &gt; 10 units</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setLosersModalOpen(true)}>
              <Eye className="h-4 w-4 mr-1" /> Review & Export
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Collection</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Days Old</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayLosers.map(l => (
                <TableRow key={l.product_id}>
                  <TableCell className="font-medium">{l.product_name}</TableCell>
                  <TableCell className="font-mono text-xs">{l.sku}</TableCell>
                  <TableCell>{l.vendor_name}</TableCell>
                  <TableCell>{l.collection_name}</TableCell>
                  <TableCell className="text-right font-mono">{l.total_inventory}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="destructive">{l.days_old}d</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {totalLoserPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-xs text-muted-foreground">{filteredLosers.length} total losers</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={loserPage === 0} onClick={() => setLoserPage(p => p - 1)}>Prev</Button>
                <span className="text-sm flex items-center px-2">{loserPage + 1}/{totalLoserPages}</span>
                <Button variant="outline" size="sm" disabled={loserPage >= totalLoserPages - 1} onClick={() => setLoserPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Losers Review Modal */}
      <Dialog open={losersModalOpen} onOpenChange={setLosersModalOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="flex items-center gap-2">
                <ArrowDown className="h-5 w-5 text-destructive" /> Losers Review ({losersForModal.length} products)
              </DialogTitle>
              <Button variant="outline" size="sm" onClick={handleExportLosers}>
                <Download className="h-4 w-4 mr-1" /> Export CSV
              </Button>
            </div>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Collection</TableHead>
                  <TableHead className="text-right">Current Price</TableHead>
                  <TableHead className="text-right">Compare At</TableHead>
                  <TableHead className="text-right">Days Old</TableHead>
                  <TableHead className="text-right">Stock Qty</TableHead>
                  <TableHead>Vendor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {losersForModal.map(l => (
                  <TableRow key={l.product_id}>
                    <TableCell className="font-medium">{l.product_name}</TableCell>
                    <TableCell className="font-mono text-xs">{l.sku}</TableCell>
                    <TableCell>{l.collection_name}</TableCell>
                    <TableCell className="text-right font-mono">{l.current_price ? formatCurrency(l.current_price) : '-'}</TableCell>
                    <TableCell className="text-right font-mono">{l.compare_at_price ? formatCurrency(l.compare_at_price) : '-'}</TableCell>
                    <TableCell className="text-right"><Badge variant="destructive">{l.days_old}d</Badge></TableCell>
                    <TableCell className="text-right font-mono">{l.total_inventory}</TableCell>
                    <TableCell>{l.vendor_name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
