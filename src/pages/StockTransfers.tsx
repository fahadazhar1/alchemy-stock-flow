import { ArrowLeftRight } from "lucide-react";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import { TransferSuggestions } from "@/components/TransferSuggestions";

// Action page of the Replenishment group: move stock between locations before reordering.
export default function StockTransfers() {
  const { storeId } = useStoreFilter();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ArrowLeftRight className="h-6 w-6" /> Stock Transfers
        </h1>
        <p className="text-sm text-muted-foreground">
          Move stock between locations before raising a purchase order — transfers update live Shopify stock
        </p>
      </div>
      <TransferSuggestions storeId={storeId} />
    </div>
  );
}
