import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ type: string; name: string; id: string }[]>([]);
  const navigate = useNavigate();

  const handleSearch = async (q: string) => {
    setQuery(q);
    if (q.length < 2) { setResults([]); return; }
    const [products, vendors, collections, campaigns] = await Promise.all([
      supabase.from("products").select("id, name, sku").or(`name.ilike.%${q}%,sku.ilike.%${q}%`).limit(5),
      supabase.from("vendors").select("id, name").ilike("name", `%${q}%`).limit(3),
      supabase.from("collections").select("id, name").ilike("name", `%${q}%`).limit(3),
      supabase.from("pricing_campaigns").select("id, name").ilike("name", `%${q}%`).limit(3),
    ]);
    const r: { type: string; name: string; id: string }[] = [];
    products.data?.forEach(p => r.push({ type: "Product", name: `${p.name} (${p.sku})`, id: p.id }));
    vendors.data?.forEach(v => r.push({ type: "Vendor", name: v.name, id: v.id }));
    collections.data?.forEach(c => r.push({ type: "Collection", name: c.name, id: c.id }));
    campaigns.data?.forEach(c => r.push({ type: "Campaign", name: c.name, id: c.id }));
    setResults(r);
  };

  const handleSelect = (item: { type: string }) => {
    setOpen(false);
    setQuery("");
    if (item.type === "Product") navigate("/products");
    else if (item.type === "Campaign") navigate("/campaigns");
    else navigate("/products");
  };

  return (
    <>
      <Button variant="outline" size="sm" className="gap-2 text-muted-foreground" onClick={() => setOpen(true)}>
        <Search className="h-4 w-4" /> <span className="hidden md:inline">Search...</span>
        <kbd className="hidden md:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">⌘K</kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg p-0">
          <div className="p-4">
            <Input placeholder="Search products, SKUs, campaigns, vendors..." value={query} onChange={e => handleSearch(e.target.value)} autoFocus />
          </div>
          {results.length > 0 && (
            <div className="border-t max-h-64 overflow-auto">
              {results.map((r, i) => (
                <button key={i} className="w-full text-left px-4 py-2 hover:bg-accent flex items-center gap-3 text-sm" onClick={() => handleSelect(r)}>
                  <span className="text-xs font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{r.type}</span>
                  <span>{r.name}</span>
                </button>
              ))}
            </div>
          )}
          {query.length >= 2 && results.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground border-t">No results found</div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
