import type { Asset, Balance } from "../domain/types";
import type { ChainAdapter } from "./types";
import { httpJson, withFallback, settleAll } from "./http";
import { getToken } from "../registry";

// Tron via TronScan (apilist.tronscanapi.com): keyless, CORS-enabled, and — unlike
// TronGrid's keyless tier, which 429s after ~3 requests — it returns the native TRX
// balance AND every TRC-20 balance in ONE request. Addresses/token ids are Base58,
// so no hex conversion is needed.
interface TronscanTrc20 {
  tokenId: string;
  balance: string;
}
interface TronscanAccount {
  balance?: number;
  trc20token_balances?: TronscanTrc20[];
}

function fetchAccount(base: string, adr: string, signal?: AbortSignal): Promise<TronscanAccount> {
  return httpJson<TronscanAccount>(`${base}/api/account?address=${encodeURIComponent(adr)}`, {
    signal,
  });
}

export const tronAdapter: ChainAdapter = {
  family: "tron",
  async fetchBalances(chain, assets, signal) {
    // One request per address covers its native + all token balances.
    const byAddr = new Map<string, Asset[]>();
    for (const a of assets) {
      const g = byAddr.get(a.adr);
      if (g) g.push(a);
      else byAddr.set(a.adr, [a]);
    }

    const perAddress = await settleAll([...byAddr], async ([adr, group]) => {
      const acct = await withFallback(chain.rpcs, (base) => fetchAccount(base, adr, signal));
      const trc20 = acct.trc20token_balances ?? [];
      return group.map((asset): Balance => {
        if (!asset.token) return { asset, raw: String(acct.balance ?? 0) };
        const { contract } = getToken(asset.token).perChain[chain.id];
        const entry = trc20.find((t) => t.tokenId === contract);
        return { asset, raw: entry ? String(entry.balance) : "0" };
      });
    });

    return perAddress.flat();
  },
};
