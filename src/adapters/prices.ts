import type { Rates } from "../domain/types";
import { httpJson } from "./http";
import { allCoingeckoIds } from "../registry";

const COINGECKO = "https://api.coingecko.com/api/v3/simple/price";

// One batched, keyless request for every coin/token we track.
export async function fetchRates(signal?: AbortSignal): Promise<Rates> {
  const ids = allCoingeckoIds().join(",");
  const url = `${COINGECKO}?ids=${ids}&vs_currencies=usd`;
  const data = await httpJson<Record<string, { usd?: number }>>(url, { signal });
  const rates: Rates = {};
  for (const [id, v] of Object.entries(data)) {
    if (typeof v?.usd === "number") rates[id] = v.usd;
  }
  return rates;
}
