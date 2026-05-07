import { useStore } from "@/contexts/StoreContext";

/**
 * Returns store filter parameters for use in Supabase queries.
 * When "All Stores" is selected, returns null (no filter).
 */
export function useStoreFilter() {
  const { selectedStoreId, isAllStores } = useStore();
  const storeId = isAllStores ? null : selectedStoreId;
  return { storeId, isAllStores };
}

/**
 * Applies store_id filter to a Supabase query builder if storeId is set.
 * For tables that have store_id column.
 */
export function applyStoreFilter<T extends { eq: (col: string, val: string) => T }>(query: T, storeId: string | null): T {
  if (storeId) return query.eq("store_id", storeId);
  return query;
}
