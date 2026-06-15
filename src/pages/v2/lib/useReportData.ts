import { useState, useEffect, useCallback, useRef } from "react";
import { useStoreFilter } from "@/hooks/useStoreFilter";
import {
  fetchSalesByChannel,
  fetchSalesTrend,
  fetchTopProducts,
  fetchInventoryHealth,
  fetchInventoryKPIs,
  fetchFulfillmentSummary,
  fetchFulfillmentTrend,
  fetchCollectionPerformance,
  fetchCollectionProducts,
  fetchRevenueKPIs,
  runCustomReport,
  type DateRange,
  type CustomReportConfig,
} from "./reportsEngine";

// ─── Generic async hook ───────────────────────────────────────────────────────

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const run = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fn();
      if (mountedRef.current) setData(result);
    } catch (e: any) {
      if (mountedRef.current) setError(e.message ?? "Unknown error");
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mountedRef.current = true;
    run();
    return () => { mountedRef.current = false; };
  }, [run]);

  return { data, isLoading, error, refetch: run };
}

// ─── Per-report hooks ─────────────────────────────────────────────────────────

export function useSalesByChannel(range: DateRange) {
  const { storeId } = useStoreFilter();
  return useAsync(() => fetchSalesByChannel(range, storeId), [range, storeId]);
}

export function useSalesTrend(range: DateRange) {
  const { storeId } = useStoreFilter();
  return useAsync(() => fetchSalesTrend(range, storeId), [range, storeId]);
}

export function useTopProducts(range: DateRange) {
  const { storeId } = useStoreFilter();
  return useAsync(() => fetchTopProducts(range, 20, storeId), [range, storeId]);
}

export function useInventoryHealth() {
  const { storeId } = useStoreFilter();
  return useAsync(() => fetchInventoryHealth(storeId), [storeId]);
}

export function useInventoryKPIs() {
  const { storeId } = useStoreFilter();
  return useAsync(() => fetchInventoryKPIs(storeId), [storeId]);
}

export function useFulfillmentSummary(range: DateRange) {
  const { storeId } = useStoreFilter();
  return useAsync(() => fetchFulfillmentSummary(range, storeId), [range, storeId]);
}

export function useFulfillmentTrend(range: DateRange) {
  const { storeId } = useStoreFilter();
  return useAsync(() => fetchFulfillmentTrend(range, storeId), [range, storeId]);
}

export function useCollectionPerformance(range: DateRange) {
  const { storeId } = useStoreFilter();
  return useAsync(() => fetchCollectionPerformance(range, storeId), [range, storeId]);
}

export function useCollectionProducts(collection: string | null, range: DateRange) {
  const { storeId } = useStoreFilter();
  return useAsync(
    () => collection ? fetchCollectionProducts(collection, range, storeId) : Promise.resolve([]),
    [collection, range, storeId],
  );
}

export function useRevenueKPIs(range: DateRange) {
  const { storeId } = useStoreFilter();
  return useAsync(() => fetchRevenueKPIs(range, storeId), [range, storeId]);
}

// ─── Custom report (manual trigger) ──────────────────────────────────────────

export function useCustomReport() {
  const { storeId } = useStoreFilter();
  const [data, setData] = useState<Record<string, number | string>[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastConfig, setLastConfig] = useState<CustomReportConfig | null>(null);

  const run = useCallback(async (config: CustomReportConfig) => {
    if (!config.metrics.length) {
      setError("Add at least one metric before running.");
      return;
    }
    if (!config.dimensions.length) {
      setError("Add at least one dimension before running.");
      return;
    }
    setIsLoading(true);
    setError(null);
    setLastConfig(config);
    try {
      const result = await runCustomReport(config, storeId);
      setData(result);
    } catch (e: any) {
      setError(e.message ?? "Query failed");
    } finally {
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  return { data, isLoading, error, lastConfig, run };
}

// ─── Re-export existing saved/scheduled hooks (unchanged) ─────────────────────
// These already exist in your codebase at @/hooks/useReports — keep using them.
export { useSavedReports, useReportSchedules } from "@/hooks/useReports";
