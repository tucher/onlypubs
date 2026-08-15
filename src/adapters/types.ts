import type { Asset, Balance, ChainConfig, Family } from "../domain/types";

// A family adapter fetches balances for assets that all belong to ONE chain.
// The store dispatches by `chain.family`; it never names a specific chain,
// so a new EVM chain needs zero adapter code — just a registry record.
export interface ChainAdapter {
  family: Family;
  fetchBalances(
    chain: ChainConfig,
    assets: Asset[],
    signal?: AbortSignal,
  ): Promise<Balance[]>;
}
