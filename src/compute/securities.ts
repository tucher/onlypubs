import type { FxRates, Holding, Quote, Quotes } from "../domain/types";

// Everything the views need to value holdings.
export interface SecuritiesData {
  holdings: Holding[];
  quotes: Quotes;
  fx: FxRates;
}

export const NO_SECURITIES: SecuritiesData = { holdings: [], quotes: {}, fx: {} };

// Some venues quote in minor units (London in pence); fx tables only carry majors.
const MINOR_UNITS: Record<string, [major: string, perMajor: number]> = {
  GBX: ["GBP", 100],
  GBp: ["GBP", 100],
  ZAc: ["ZAR", 100],
  ILA: ["ILS", 100],
};

// null when the currency has no rate yet — unknown, which is not zero.
export function toUsd(amount: number, currency: string, fx: FxRates): number | null {
  const minor = MINOR_UNITS[currency];
  const cur = minor ? minor[0] : currency;
  const major = minor ? amount / minor[1] : amount;
  if (cur === "USD") return major;
  const perUsd = fx[cur];
  return perUsd ? major / perUsd : null;
}

// The position's value in the quote's currency. A bond is worth its clean price
// plus accrued interest — what a buyer would pay for it today.
export function quoteValue(qty: number, quote: Quote): number {
  if (!quote.percent) return qty * quote.price;
  return qty * (quote.price + (quote.accrued ?? 0)) * 0.01;
}

// Unpriced holdings count as 0, like unquoted coins in the crypto totals.
export function holdingUsd(h: Holding, data: SecuritiesData): number {
  const q = data.quotes[h.isin];
  if (!q) return 0;
  return toUsd(quoteValue(h.qty, q), q.currency, data.fx) ?? 0;
}
