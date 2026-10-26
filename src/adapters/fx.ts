import type { FxRates } from "../domain/types";
import { httpJson, withFallback } from "./http";

// Fiat rates for valuing securities in USD. Both sources are keyless and send
// `access-control-allow-origin: *`; daily reference rates are plenty here.
const FRANKFURTER = "https://api.frankfurter.dev/v1/latest?from=USD"; // ECB reference rates
const ER_API = "https://open.er-api.com/v6/latest/USD";

interface FrankfurterResponse {
  rates?: Record<string, number>;
}

interface ErApiResponse {
  result?: string;
  rates?: Record<string, number>;
}

async function fetchFrom(url: string, signal?: AbortSignal): Promise<FxRates> {
  let rates: Record<string, number> | undefined;
  if (url === FRANKFURTER) {
    rates = (await httpJson<FrankfurterResponse>(url, { signal })).rates;
  } else {
    const d = await httpJson<ErApiResponse>(url, { signal });
    if (d.result === "success") rates = d.rates;
  }
  if (!rates || typeof rates.EUR !== "number") throw new Error(`${url}: unrecognized rates`);
  // Frankfurter leaves the base out of its own table
  return { ...rates, USD: 1 };
}

export function fetchFx(signal?: AbortSignal): Promise<FxRates> {
  return withFallback([FRANKFURTER, ER_API], (url) => fetchFrom(url, signal));
}
