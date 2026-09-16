import { describe, it, expect, vi, afterEach } from "vitest";
import { getChain } from "../registry";
import { encodeBalanceOf, evmAdapter } from "./evm";
import { utxoAdapter } from "./utxo";
import { tonAdapter } from "./ton";
import { tronAdapter } from "./tron";
import { fetchAllBalances } from "./index";

function mockFetch(handler: (url: string, init?: any) => any) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: any) => {
      const result = handler(String(url), init);
      if (result === undefined) throw new Error(`network error for ${url}`);
      return {
        ok: true,
        status: 200,
        json: async () => result,
      } as Response;
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("evm encoding", () => {
  it("encodes balanceOf calldata (selector + padded address)", () => {
    expect(encodeBalanceOf("0xA96783fF57be417D98F8D6d22343D9CcCC3c4f16")).toBe(
      "0x70a08231000000000000000000000000a96783ff57be417d98f8d6d22343d9cccc3c4f16",
    );
  });

  it("fetches native + token balances via JSON-RPC", async () => {
    mockFetch((_url, init) => {
      const body = JSON.parse(init.body);
      if (body.method === "eth_getBalance") return { jsonrpc: "2.0", id: 1, result: "0xde0b6b3a7640000" }; // 1e18
      if (body.method === "eth_call") return { jsonrpc: "2.0", id: 1, result: "0x0000000000000000000000000000000000000000000000000000000005f5e100" }; // 1e8
      return {};
    });
    const eth = getChain("eth");
    const balances = await evmAdapter.fetchBalances(eth, [
      { chain: "eth", token: null, adr: "0xabc", title: null },
      { chain: "eth", token: "usdt", adr: "0xabc", title: null },
    ]);
    expect(balances[0].raw).toBe("1000000000000000000");
    expect(balances[1].raw).toBe("100000000");
  });
});

describe("tron adapter (TronScan -> TronGrid)", () => {
  it("reads native + TRC-20 balances from one account call", async () => {
    mockFetch((url) =>
      url.includes("tronscanapi")
        ? {
            balance: 5000000, // 5 TRX
            trc20token_balances: [
              { tokenId: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", balance: "100000000" }, // 100 USDT
            ],
          }
        : undefined,
    );
    const trx = getChain("trx");
    const balances = await tronAdapter.fetchBalances(trx, [
      { chain: "trx", token: null, adr: "TXYZ", title: null },
      { chain: "trx", token: "usdt", adr: "TXYZ", title: null },
    ]);
    expect(balances.find((b) => !b.asset.token)?.raw).toBe("5000000");
    expect(balances.find((b) => b.asset.token === "usdt")?.raw).toBe("100000000");
  });

  it("returns 0 for a token the address does not hold", async () => {
    mockFetch((url) =>
      url.includes("tronscanapi") ? { balance: 0, trc20token_balances: [] } : undefined,
    );
    const trx = getChain("trx");
    const balances = await tronAdapter.fetchBalances(trx, [
      { chain: "trx", token: "usdt", adr: "TXYZ", title: null },
    ]);
    expect(balances[0].raw).toBe("0");
  });

  it("fails over to TronGrid when TronScan is unreachable", async () => {
    mockFetch((url) =>
      url.includes("trongrid")
        ? {
            success: true,
            data: [
              {
                balance: 7000000, // 7 TRX
                trc20: [{ TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: "250000000" }], // 250 USDT
              },
            ],
          }
        : undefined, // TronScan throws
    );
    const trx = getChain("trx");
    const balances = await tronAdapter.fetchBalances(trx, [
      { chain: "trx", token: null, adr: "TXYZ", title: null },
      { chain: "trx", token: "usdt", adr: "TXYZ", title: null },
    ]);
    expect(balances.find((b) => !b.asset.token)?.raw).toBe("7000000");
    expect(balances.find((b) => b.asset.token === "usdt")?.raw).toBe("250000000");
  });

  it("fails over when TronScan returns 200 with an unrecognized shape", async () => {
    // A shape change must NOT read as an empty wallet: no recognizable field means
    // fail over, not report zero.
    mockFetch((url) =>
      url.includes("tronscanapi")
        ? { message: "api key required" }
        : { success: true, data: [{ balance: 3000000 }] },
    );
    const trx = getChain("trx");
    const balances = await tronAdapter.fetchBalances(trx, [
      { chain: "trx", token: null, adr: "TXYZ", title: null },
    ]);
    expect(balances[0].raw).toBe("3000000");
  });

  it("fails over when TronScan omits the TRC-20 section for a token asset", async () => {
    // `balance` alone parses fine, but it cannot answer a USDT row. Reporting 0
    // would be indistinguishable from an emptied wallet, so go to the fallback.
    mockFetch((url) =>
      url.includes("tronscanapi")
        ? { balance: 5000000 } // no trc20token_balances
        : {
            success: true,
            data: [{ balance: 5000000, trc20: [{ TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: "42" }] }],
          },
    );
    const trx = getChain("trx");
    const balances = await tronAdapter.fetchBalances(trx, [
      { chain: "trx", token: "usdt", adr: "TXYZ", title: null },
    ]);
    expect(balances[0].raw).toBe("42");
  });

  it("marks the chain failed rather than reporting 0 when no provider has TRC-20 data", async () => {
    mockFetch((url) =>
      url.includes("tronscanapi")
        ? { balance: 5000000 }
        : { success: true, data: [{ balance: 5000000 }] },
    );
    const trx = getChain("trx");
    await expect(
      tronAdapter.fetchBalances(trx, [
        { chain: "trx", token: "usdt", adr: "TXYZ", title: null },
      ]),
    ).rejects.toThrow();
  });

  it("reads an unactivated address (empty TronGrid data) as zero", async () => {
    mockFetch((url) => (url.includes("trongrid") ? { success: true, data: [] } : undefined));
    const trx = getChain("trx");
    const balances = await tronAdapter.fetchBalances(trx, [
      { chain: "trx", token: null, adr: "TXYZ", title: null },
      { chain: "trx", token: "usdt", adr: "TXYZ", title: null },
    ]);
    expect(balances.every((b) => b.raw === "0")).toBe(true);
  });
});

describe("utxo adapter", () => {
  it("sums confirmed + unconfirmed satoshis", async () => {
    mockFetch(() => ({
      chain_stats: { funded_txo_sum: 200000000, spent_txo_sum: 50000000 },
      mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
    }));
    const btc = getChain("btc");
    const balances = await utxoAdapter.fetchBalances(btc, [
      { chain: "btc", token: null, adr: "bc1xyz", title: null },
    ]);
    expect(balances[0].raw).toBe("150000000"); // 1.5 BTC
  });
});

describe("ton adapter", () => {
  it("reads nanotons from tonapi", async () => {
    mockFetch((url) => (url.includes("tonapi") ? { balance: 2500000000 } : undefined));
    const ton = getChain("ton");
    const balances = await tonAdapter.fetchBalances(ton, [
      { chain: "ton", token: null, adr: "EQabc", title: null },
    ]);
    expect(balances[0].raw).toBe("2500000000"); // 2.5 TON
  });
});

describe("fetchAllBalances — per-chain isolation + endpoint fallback", () => {
  it("marks a failing chain ok:false without sinking others, and fails over endpoints", async () => {
    mockFetch((url) => {
      // first BTC endpoint (blockstream) fails; second (mempool) succeeds
      if (url.includes("blockstream")) return undefined;
      if (url.includes("mempool")) {
        return {
          chain_stats: { funded_txo_sum: 100000000, spent_txo_sum: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        };
      }
      // all EVM endpoints fail
      return undefined;
    });
    const outcomes = await fetchAllBalances([
      { chain: "btc", token: null, adr: "bc1", title: null },
      { chain: "eth", token: null, adr: "0x1", title: null },
    ]);
    const btc = outcomes.find((o) => o.chain === "btc")!;
    const eth = outcomes.find((o) => o.chain === "eth")!;
    expect(btc.ok).toBe(true);
    expect(btc.balances[0].raw).toBe("100000000");
    expect(eth.ok).toBe(false);
    expect(eth.balances).toEqual([]);
  });
});
