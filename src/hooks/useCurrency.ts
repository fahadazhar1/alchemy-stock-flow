import { useStore } from "@/contexts/StoreContext";

export function useCurrency() {
  const { selectedStore } = useStore();

  const code   = selectedStore?.currency        ?? "GBP";
  const symbol = selectedStore?.currency_symbol ?? "£";
  const locale = "en-GB";

  const formatCurrency = (amount: number): string =>
    `${symbol}${amount.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fmtCurrency = (n: number | null | undefined): string => {
    if (n == null) return "—";
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${symbol}${(n / 1_000_000).toFixed(2)}M`;
    if (abs >= 10_000) return `${symbol}${(n / 1_000).toFixed(1)}k`;
    return `${symbol}${n.toLocaleString(locale, { maximumFractionDigits: 0 })}`;
  };

  const fmtCurrencyInt = (n: number): string =>
    `${symbol}${n.toLocaleString(locale, { maximumFractionDigits: 0 })}`;

  const fmtAxis = (v: number): string =>
    v >= 1_000 ? `${symbol}${(v / 1_000).toFixed(0)}k` : `${symbol}${v}`;

  return { formatCurrency, fmtCurrency, fmtCurrencyInt, fmtAxis, code, locale, symbol };
}
