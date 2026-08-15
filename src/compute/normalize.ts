import type { Asset, Balance, Rates } from "../domain/types";
import { assetCoingeckoId, assetDecimals, isChainAsset } from "../registry";

// raw integer balance string -> human coin amount (raw / 10^decimals).
// Uses BigInt for the integer part to stay exact for large balances, then
// converts to Number for display math (fractional cents are irrelevant here).
export function normalizedCoins(raw: string, asset: Asset): number {
  const decimals = assetDecimals(asset);
  return rawToNumber(raw, decimals);
}

export function rawToNumber(raw: string, decimals: number): number {
  if (!raw) return 0;
  const negative = raw.startsWith("-");
  const digits = (negative ? raw.slice(1) : raw).replace(/[^0-9]/g, "");
  if (digits === "") return 0;
  const value = Number(digits) / 10 ** decimals;
  return negative ? -value : value;
}

// Price lookup mirrors iOS defaults: missing chain price -> 0, missing token price -> 1
// (stablecoins are assumed ~$1 when a quote is unavailable).
export function priceOf(asset: Asset, rates: Rates): number {
  const id = assetCoingeckoId(asset);
  const quoted = rates[id];
  if (quoted !== undefined) return quoted;
  return isChainAsset(asset) ? 0 : 1;
}

export function usdValue(balance: Balance, rates: Rates): number {
  return normalizedCoins(balance.raw, balance.asset) * priceOf(balance.asset, rates);
}
