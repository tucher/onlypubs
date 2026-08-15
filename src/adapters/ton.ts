import type { ChainAdapter } from "./types";
import { httpJson, withFallback } from "./http";

// TON via tonapi.io (accepts user-friendly addresses) with toncenter fallback.
// Both return the balance in nanotons (raw integer). Native only (no TON tokens here).
async function tonBalance(base: string, adr: string, signal?: AbortSignal): Promise<string> {
  if (base.includes("tonapi")) {
    const d = await httpJson<{ balance?: number | string }>(
      `${base}/v2/accounts/${encodeURIComponent(adr)}`,
      { signal },
    );
    return String(d.balance ?? 0);
  }
  // toncenter: base already ends with /api/v2
  const d = await httpJson<{ ok: boolean; result?: string }>(
    `${base}/getAddressBalance?address=${encodeURIComponent(adr)}`,
    { signal },
  );
  return String(d.result ?? 0);
}

export const tonAdapter: ChainAdapter = {
  family: "ton",
  async fetchBalances(chain, assets, signal) {
    return Promise.all(
      assets.map(async (asset) => ({
        asset,
        raw: await withFallback(chain.rpcs, (base) => tonBalance(base, asset.adr, signal)),
      })),
    );
  },
};
