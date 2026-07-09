import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/contexts/StoreContext";
import { useRole } from "@/hooks/useRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { toast } from "sonner";
import { PackagePlus, X, ExternalLink, Archive, Loader2 } from "lucide-react";

interface BookOption {
  id: string;
  name: string;
  sku: string;
  price: number;
}

interface Bundle {
  id: string;
  store_id: string;
  shopify_product_id: string;
  handle: string | null;
  title: string;
  price: number;
  badge_text: string | null;
  subtitle: string | null;
  book_product_ids: string[];
  status: "active" | "archived";
  created_at: string;
}

const EMPTY_FORM = { title: "", subtitle: "", badgeText: "", price: "" };

export default function BundleBuilder() {
  const { selectedStore, isAllStores } = useStore();
  const { canEdit } = useRole();
  const queryClient = useQueryClient();

  const storeId = selectedStore?.id ?? null;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [pickedBooks, setPickedBooks] = useState<BookOption[]>([]);
  const [bookQuery, setBookQuery] = useState("");
  const [bookResults, setBookResults] = useState<BookOption[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: bundles = [], isLoading } = useQuery({
    queryKey: ["bundles", storeId],
    queryFn: async () => {
      if (!storeId) return [];
      const { data, error } = await supabase
        .from("bundles" as any)
        .select("*")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Bundle[];
    },
    enabled: !!storeId,
  });

  const searchBooks = async (q: string) => {
    setBookQuery(q);
    if (!storeId || q.length < 2) {
      setBookResults([]);
      return;
    }
    const { data: products } = await supabase
      .from("products")
      .select("id, name, sku")
      .eq("store_id", storeId)
      .or(`name.ilike.%${q}%,sku.ilike.%${q}%`)
      .limit(8);
    if (!products?.length) {
      setBookResults([]);
      return;
    }
    const ids = products.map((p) => p.id);
    const { data: variants } = await supabase.from("variants").select("product_id, price").in("product_id", ids);
    const priceByProduct = new Map<string, number>();
    variants?.forEach((v) => {
      if (!priceByProduct.has(v.product_id)) priceByProduct.set(v.product_id, Number(v.price));
    });
    setBookResults(products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, price: priceByProduct.get(p.id) ?? 0 })));
  };

  const addBook = (b: BookOption) => {
    if (pickedBooks.some((x) => x.id === b.id)) return;
    setPickedBooks((prev) => [...prev, b]);
    setBookQuery("");
    setBookResults([]);
    setPickerOpen(false);
  };
  const removeBook = (id: string) => setPickedBooks((prev) => prev.filter((b) => b.id !== id));

  const individualTotal = pickedBooks.reduce((sum, b) => sum + b.price, 0);
  const bundlePrice = parseFloat(form.price) || 0;
  const savings = individualTotal - bundlePrice;

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setPickedBooks([]);
    setBookQuery("");
    setBookResults([]);
  };

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

  const createMutation = useMutation({
    mutationFn: async () => {
      const connectionId = await resolveConnectionId();
      const { data, error } = await supabase.functions.invoke("bundle-builder", {
        body: {
          action: "create_bundle",
          connection_id: connectionId,
          store_id: storeId,
          title: form.title,
          price: bundlePrice,
          badge_text: form.badgeText || undefined,
          subtitle: form.subtitle || undefined,
          book_ids: pickedBooks.map((b) => b.id),
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Bundle creation failed");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["bundles", storeId] });
      toast.success("Bundle created!", { description: data.manualSteps?.[0] });
      setDialogOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archiveMutation = useMutation({
    mutationFn: async (bundleId: string) => {
      const connectionId = await resolveConnectionId();
      const { data, error } = await supabase.functions.invoke("bundle-builder", {
        body: { action: "archive_bundle", connection_id: connectionId, bundle_id: bundleId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Archive failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bundles", storeId] });
      toast.success("Bundle archived");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit = !!storeId && form.title.trim().length > 0 && pickedBooks.length >= 2 && bundlePrice > 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PackagePlus className="h-6 w-6" /> Bundle Builder
          </h1>
          <p className="text-sm text-muted-foreground">
            Create book bundles that publish straight to the storefront — same design as every other bundle page.
          </p>
        </div>
        <Button disabled={!canEdit || isAllStores} onClick={() => setDialogOpen(true)}>
          <PackagePlus className="h-4 w-4 mr-2" /> New Bundle
        </Button>
      </div>

      {isAllStores && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Select a specific store above to create or manage bundles.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bundles — {selectedStore?.store_name ?? "—"}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Books</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && bundles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No bundles yet for this store.
                  </TableCell>
                </TableRow>
              )}
              {bundles.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.title}</TableCell>
                  <TableCell>{b.book_product_ids.length} books</TableCell>
                  <TableCell>{b.price}</TableCell>
                  <TableCell>
                    <Badge variant={b.status === "active" ? "default" : "secondary"}>{b.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    {b.handle && b.status === "active" && selectedStore?.store_url && (
                      <Button variant="ghost" size="icon" asChild>
                        <a href={`https://${selectedStore.store_url}/products/${b.handle}`} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    {canEdit && b.status === "active" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => archiveMutation.mutate(b.id)}
                        disabled={archiveMutation.isPending}
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Bundle</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Prophet Stories Bundle"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Subtitle</Label>
              <Input
                value={form.subtitle}
                onChange={(e) => setForm((f) => ({ ...f, subtitle: e.target.value }))}
                placeholder="Curated reading set"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Badge text</Label>
              <Input
                value={form.badgeText}
                onChange={(e) => setForm((f) => ({ ...f, badgeText: e.target.value }))}
                placeholder="BOOK BUNDLE"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Bundle price</Label>
              <Input
                type="number"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                placeholder="0.00"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Books ({pickedBooks.length})</Label>
              {pickedBooks.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {pickedBooks.map((b) => (
                    <Badge key={b.id} variant="secondary" className="gap-1">
                      {b.name}
                      <button type="button" onClick={() => removeBook(b.id)}>
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-start text-muted-foreground">
                    + Add a book...
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0 w-[420px]" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput placeholder="Search by title or SKU..." value={bookQuery} onValueChange={searchBooks} />
                    <CommandList>
                      <CommandEmpty>{bookQuery.length < 2 ? "Type at least 2 characters" : "No books found"}</CommandEmpty>
                      <CommandGroup>
                        {bookResults.map((b) => (
                          <CommandItem key={b.id} onSelect={() => addBook(b)}>
                            <span className="flex-1">{b.name}</span>
                            <span className="text-xs text-muted-foreground ml-2">{b.price}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {pickedBooks.length > 0 && (
              <div className="rounded-md border p-3 text-sm space-y-1 bg-muted/40">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Individual total</span>
                  <span>{individualTotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Bundle price</span>
                  <span>{bundlePrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Savings shown to customer</span>
                  <span className={savings > 0 ? "text-green-600" : "text-muted-foreground"}>
                    {savings > 0 ? savings.toFixed(2) : "None (free shipping badge instead)"}
                  </span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!canSubmit || createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Bundle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}