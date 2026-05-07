import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Store as StoreIcon, Plus, Pencil, Link, RefreshCw, Warehouse } from "lucide-react";
import { formatUAEDateTime } from "@/lib/timezone";
import { useCentralInventoryKPIs } from "@/hooks/useCentralInventory";

interface StoreForm {
  store_name: string;
  store_code: string;
  platform: string;
  store_url: string;
  is_active: boolean;
}

const emptyForm: StoreForm = { store_name: "", store_code: "", platform: "shopify", store_url: "", is_active: true };

export default function StoreManagement() {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<StoreForm>(emptyForm);
  const { data: centralKPIs } = useCentralInventoryKPIs();

  const { data: stores, isLoading } = useQuery({
    queryKey: ["all-stores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("stores").select("*").order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const openAdd = () => { setEditId(null); setForm(emptyForm); setEditOpen(true); };
  const openEdit = (s: any) => {
    setEditId(s.id);
    setForm({ store_name: s.store_name, store_code: s.store_code, platform: s.platform || "shopify", store_url: s.store_url || "", is_active: s.is_active });
    setEditOpen(true);
  };

  const handleSave = async () => {
    if (!form.store_name.trim() || !form.store_code.trim()) { toast.error("Name and code are required"); return; }
    try {
      if (editId) {
        const { error } = await supabase.from("stores").update({ store_name: form.store_name, store_code: form.store_code, platform: form.platform, store_url: form.store_url || null, is_active: form.is_active }).eq("id", editId);
        if (error) throw error;
        toast.success("Store updated");
      } else {
        const { error } = await supabase.from("stores").insert({ store_name: form.store_name, store_code: form.store_code, platform: form.platform, store_url: form.store_url || null, is_active: form.is_active, connected_at: new Date().toISOString() });
        if (error) throw error;
        toast.success("Store added");
      }
      queryClient.invalidateQueries({ queryKey: ["all-stores"] });
      queryClient.invalidateQueries({ queryKey: ["stores"] });
      setEditOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><StoreIcon className="h-6 w-6" /> Store Management</h1>
          <p className="text-sm text-muted-foreground">Manage your connected stores and sync configurations</p>
        </div>
        <Button onClick={openAdd}><Plus className="h-4 w-4 mr-1" /> Add Store</Button>
      </div>

      {/* Central WMS Summary */}
      {centralKPIs && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Warehouse className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Central WMS Inventory</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-xs">
              <div className="bg-background/80 p-2 rounded"><span className="text-muted-foreground">Master SKUs</span><p className="font-bold text-lg">{centralKPIs.totalSKUs.toLocaleString()}</p></div>
              <div className="bg-background/80 p-2 rounded"><span className="text-muted-foreground">Products</span><p className="font-bold text-lg">{centralKPIs.uniqueProducts.toLocaleString()}</p></div>
              <div className="bg-background/80 p-2 rounded"><span className="text-muted-foreground">Available</span><p className="font-bold text-lg">{centralKPIs.totalAvailable.toLocaleString()}</p></div>
              <div className="bg-background/80 p-2 rounded"><span className="text-muted-foreground">Reserved</span><p className="font-bold text-lg">{centralKPIs.totalReserved.toLocaleString()}</p></div>
              <div className="bg-background/80 p-2 rounded"><span className="text-muted-foreground">Net Available</span><p className="font-bold text-lg">{centralKPIs.totalNetAvailable.toLocaleString()}</p></div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? <p className="text-muted-foreground">Loading...</p> : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Connected</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(stores ?? []).map(s => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.store_name}</TableCell>
                  <TableCell className="font-mono text-xs">{s.store_code}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{s.platform}</Badge></TableCell>
                  <TableCell className="text-xs truncate max-w-[200px]">{s.store_url || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={s.is_active ? "default" : "secondary"}>{s.is_active ? "Active" : "Inactive"}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{s.connected_at ? formatUAEDateTime(s.connected_at) : '-'}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(s)}><Pencil className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="sm" title="Sync Store Data"><RefreshCw className="h-3 w-3" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Edit Store" : "Add Store"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Store Name *</Label><Input value={form.store_name} onChange={e => setForm({ ...form, store_name: e.target.value })} placeholder="e.g. Dubai Mall Flagship" /></div>
            <div><Label>Store Code *</Label><Input value={form.store_code} onChange={e => setForm({ ...form, store_code: e.target.value })} placeholder="e.g. dubai-mall" /></div>
            <div><Label>Platform</Label><Input value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })} placeholder="shopify" /></div>
            <div><Label>Store URL</Label><Input value={form.store_url} onChange={e => setForm({ ...form, store_url: e.target.value })} placeholder="https://..." /></div>
            <div className="flex items-center justify-between"><Label>Active</Label><Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} /></div>
          </div>
          <DialogFooter><Button onClick={handleSave}>{editId ? "Update" : "Create"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
