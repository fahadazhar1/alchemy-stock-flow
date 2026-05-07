import { useStore } from "@/contexts/StoreContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Store as StoreIcon } from "lucide-react";

export function StoreSelector() {
  const { stores, selectedStoreId, isAllStores, setSelectedStoreId, setAllStores } = useStore();

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
          <SelectItem value="all">All Stores</SelectItem>
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
