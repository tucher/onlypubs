import type { Asset, Balance, ChainConfig } from "../domain/types";
import type { ChainAdapter } from "./types";
import { httpJson, withFallback, settleAll } from "./http";
import { getToken } from "../registry";

// EVM (ETH, BNB, and any future JSON-RPC chain) with plain fetch — no SDK.
// native: eth_getBalance; ERC-20/BEP-20: eth_call balanceOf(address).

const BALANCE_OF_SELECTOR = "0x70a08231"; // keccak256("balanceOf(address)")[:4]

// left-pad a 20-byte hex address to a 32-byte ABI word
export function encodeBalanceOf(address: string): string {
  const clean = address.toLowerCase().replace(/^0x/, "");
  return BALANCE_OF_SELECTOR + clean.padStart(64, "0");
}

async function rpc(
  base: string,
  method: string,
  params: unknown[],
  signal?: AbortSignal,
): Promise<string> {
  const res = await httpJson<{ result?: string; error?: { message?: string } }>(base, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal,
  });
  if (res.error) throw new Error(res.error.message ?? "rpc error");
  if (res.result === undefined) throw new Error("rpc: empty result");
  return res.result;
}

function hexToDecimalString(hex: string): string {
  if (!hex || hex === "0x") return "0";
  return BigInt(hex).toString();
}

async function fetchOne(
  chain: ChainConfig,
  asset: Asset,
  signal?: AbortSignal,
): Promise<Balance> {
  const raw = await withFallback(chain.rpcs, async (base) => {
    if (!asset.token) {
      const hex = await rpc(base, "eth_getBalance", [asset.adr, "latest"], signal);
      return hexToDecimalString(hex);
    }
    const { contract } = getToken(asset.token).perChain[chain.id];
    const data = encodeBalanceOf(asset.adr);
    const hex = await rpc(base, "eth_call", [{ to: contract, data }, "latest"], signal);
    return hexToDecimalString(hex);
  });
  return { asset, raw };
}

export const evmAdapter: ChainAdapter = {
  family: "evm",
  async fetchBalances(chain, assets, signal) {
    return settleAll(assets, (a) => fetchOne(chain, a, signal));
  },
};
