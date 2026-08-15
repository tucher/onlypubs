import type { Asset, Balance, ChainId, Family } from "../domain/types";
import { getChain } from "../registry";
import type { ChainAdapter } from "./types";
import { utxoAdapter } from "./utxo";
import { evmAdapter } from "./evm";
import { tronAdapter } from "./tron";
import { tonAdapter } from "./ton";

export { fetchRates } from "./prices";

// family -> adapter. Adding a brand-new protocol is the only case that touches code here.
const ADAPTERS: Record<Family, ChainAdapter> = {
  utxo: utxoAdapter,
  evm: evmAdapter,
  tron: tronAdapter,
  ton: tonAdapter,
};

export interface ChainFetchOutcome {
  chain: ChainId;
  balances: Balance[];
  ok: boolean;
}

// Fetch all assets, grouped by chain, in parallel. Each chain resolves
// independently: a failing chain yields ok:false (so the store can mark it
// failed and keep cached values) without sinking the others.
export async function fetchAllBalances(
  assets: Asset[],
  signal?: AbortSignal,
): Promise<ChainFetchOutcome[]> {
  const byChainId = new Map<ChainId, Asset[]>();
  for (const a of assets) {
    const arr = byChainId.get(a.chain);
    if (arr) arr.push(a);
    else byChainId.set(a.chain, [a]);
  }

  return Promise.all(
    [...byChainId].map(async ([chainId, chainAssets]): Promise<ChainFetchOutcome> => {
      const chain = getChain(chainId);
      const adapter = ADAPTERS[chain.family];
      try {
        const balances = await adapter.fetchBalances(chain, chainAssets, signal);
        return { chain: chainId, balances, ok: true };
      } catch {
        return { chain: chainId, balances: [], ok: false };
      }
    }),
  );
}
