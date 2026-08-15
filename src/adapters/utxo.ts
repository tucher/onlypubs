import type { Balance } from "../domain/types";
import type { ChainAdapter } from "./types";
import { httpJson, withFallback, settleAll } from "./http";

// Bitcoin via blockstream.info / mempool.space (both share the Esplora shape).
// balance = confirmed + unconfirmed, in satoshis (raw integer).
interface EsploraStats {
  funded_txo_sum: number;
  spent_txo_sum: number;
}
interface EsploraAddress {
  chain_stats: EsploraStats;
  mempool_stats: EsploraStats;
}

export const utxoAdapter: ChainAdapter = {
  family: "utxo",
  async fetchBalances(chain, assets, signal) {
    return settleAll(assets, async (asset): Promise<Balance> => {
      const raw = await withFallback(chain.rpcs, async (base) => {
        const d = await httpJson<EsploraAddress>(`${base}/address/${asset.adr}`, { signal });
        const sat =
          BigInt(d.chain_stats.funded_txo_sum) -
          BigInt(d.chain_stats.spent_txo_sum) +
          BigInt(d.mempool_stats.funded_txo_sum) -
          BigInt(d.mempool_stats.spent_txo_sum);
        return sat.toString();
      });
      return { asset, raw };
    });
  },
};
