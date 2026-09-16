import type { Asset, Balance } from "../domain/types";
import type { ChainAdapter } from "./types";
import { httpJson, withFallback, settleAll } from "./http";
import { getToken } from "../registry";

// Tron via TronScan (apilist.tronscanapi.com) with a TronGrid failover. Both are
// keyless + CORS-enabled, both speak Base58 (no hex conversion), and both return
// the native TRX balance AND every TRC-20 balance in ONE request per address —
// they just wrap it differently, so each provider is parsed into `TronAccount`.
interface TronAccount {
  trx: string; // native balance in SUN, raw integer string
  // Base58 contract -> raw balance. `null` means the response carried no TRC-20
  // section at all, so a token balance here is UNKNOWN — which is NOT zero.
  trc20: Map<string, string> | null;
}

interface TronscanAccount {
  balance?: number;
  trc20token_balances?: { tokenId: string; balance: string }[];
}

// TronGrid wraps the account in `data`. An EMPTY `data` is a real answer: an
// unactivated address that holds nothing.
interface TrongridAccount {
  success?: boolean;
  data?: { balance?: number; trc20?: Record<string, string>[] }[];
}

function parseTronscan(d: TronscanAccount): TronAccount {
  // A 200 carrying NEITHER field is not an empty wallet — it means the response
  // shape changed under us, or an error/throttle body came back dressed as 200.
  if (d.balance === undefined && d.trc20token_balances === undefined) {
    throw new Error("tronscan: unrecognized account response");
  }
  const list = d.trc20token_balances;
  return {
    trx: String(d.balance ?? 0),
    trc20: list ? new Map(list.map((t) => [t.tokenId, String(t.balance)])) : null,
  };
}

function parseTrongrid(d: TrongridAccount): TronAccount {
  if (d.success === false || !Array.isArray(d.data)) {
    throw new Error("trongrid: unrecognized account response");
  }
  const acct = d.data[0];
  if (!acct) return { trx: "0", trc20: new Map() }; // unactivated address: holds nothing
  const list = acct.trc20;
  return {
    trx: String(acct.balance ?? 0),
    // `trc20` is a list of single-entry { contract: balance } objects.
    trc20: list
      ? new Map(list.flatMap((e) => Object.entries(e).map(([c, b]) => [c, String(b)] as const)))
      : null,
  };
}

function fetchAccount(base: string, adr: string, signal?: AbortSignal): Promise<TronAccount> {
  if (base.includes("tronscan")) {
    return httpJson<TronscanAccount>(
      `${base}/api/account?address=${encodeURIComponent(adr)}`,
      { signal },
    ).then(parseTronscan);
  }
  return httpJson<TrongridAccount>(`${base}/v1/accounts/${encodeURIComponent(adr)}`, {
    signal,
  }).then(parseTrongrid);
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
      const needTokens = group.some((a) => a.token !== null);
      const acct = await withFallback(chain.rpcs, async (base) => {
        const a = await fetchAccount(base, adr, signal);
        // A response with no TRC-20 section cannot answer a token asset, and
        // reporting 0 would look exactly like an emptied wallet. Reject it here,
        // inside the failover, so the next provider gets a turn.
        if (needTokens && !a.trc20) throw new Error(`${base}: no TRC-20 data for ${adr}`);
        return a;
      });
      return group.map((asset): Balance => {
        if (!asset.token) return { asset, raw: acct.trx };
        const { contract } = getToken(asset.token).perChain[chain.id];
        // `trc20` is non-null here: the guard above rejected any account that
        // lacked it while this group needed tokens.
        return { asset, raw: acct.trc20?.get(contract) ?? "0" };
      });
    });

    return perAddress.flat();
  },
};
