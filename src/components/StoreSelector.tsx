import { useLocation } from "react-router-dom";
import { useStore } from "@/contexts/StoreContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Store as StoreIcon } from "lucide-react";

// "All Stores" aggregates data across currencies/timezones in ways most pages
// were never built to handle (mixed totals, wrong currency symbols, etc.) —
// confirmed confusing users elsewhere. Only these two pages are actually
// designed for an aggregate view; every other page only ever gets a single
// selected store.
export const ALL_STORES_ROUTES = ["/store-performance", "/pnl"];

export function StoreSelector() {
  const { stores, selectedStoreId, isAllStores, setSelectedStoreId, setAllStores } = useStore();
  const location = useLocation();
  const allStoresAllowed = ALL_STORES_ROUTES.includes(location.pathname);

  const currentValue = isAllStores ? "all" : (selectedStoreId ?? "");

  return (
    <div className="flex items-center gap-2">
      <StoreIcon className="h-4 w-4 text-muted-foreground shrink-0" />
      <Select
        value={currentValue}
        onValueChange={(v) => {
          if (v === "all") setAllStores();
          else setSelectedStoreId(v);
        }}
      >
        <SelectTrigger className="w-[180px] h-8 text-xs">
          <SelectValue placeholder="Select store..." />
        </SelectTrigger>
        <SelectContent>
          {allStoresAllowed && <SelectItem value="all">All Stores</SelectItem>}
          {stores.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.store_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
