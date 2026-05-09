import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchSalesByChannel,
  fetchSalesTrend,
  fetchTopProducts,
  fetchInventoryHealth,
  fetchInventoryKPIs,
  fetchFulfillmentSummary,
  fetchFulfillmentTrend,
  fetchCollectionPerformance,
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
  return useAsync(() => fetchSalesByChannel(range), [range]);
}

export function useSalesTrend(range: DateRange) {
  return useAsync(() => fetchSalesTrend(range), [range]);
}

export function useTopProducts(range: DateRange) {
  return useAsync(() => fetchTopProducts(range), [range]);
}

export function useInventoryHealth() {
  return useAsync(() => fetchInventoryHealth(), []);
}

export function useInventoryKPIs() {
  return useAsync(() => fetchInventoryKPIs(), []);
}

export function useFulfillmentSummary(range: DateRange) {
  return useAsync(() => fetchFulfillmentSummary(range), [range]);
}

export function useFulfillmentTrend(range: DateRange) {
  return useAsync(() => fetchFulfillmentTrend(range), [range]);
}

export function useCollectionPerformance(range: DateRange) {
  return useAsync(() => fetchCollectionPerformance(range), [range]);
}

export function useRevenueKPIs(range: DateRange) {
  return useAsync(() => fetchRevenueKPIs(range), [range]);
}

// ─── Custom report (manual trigger) ──────────────────────────────────────────

export function useCustomReport() {
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
      const result = await runCustomReport(config);
      setData(result);
    } catch (e: any) {
      setError(e.message ?? "Query failed");
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { data, isLoading, error, lastConfig, run };
}

// ─── Re-export existing saved/scheduled hooks (unchanged) ─────────────────────
// These already exist in your codebase at @/hooks/useReports — keep using them.
export { useSavedReports, useReportSchedules } from "@/hooks/useReports";
