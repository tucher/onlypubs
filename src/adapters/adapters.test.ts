import { describe, it, expect, vi, afterEach } from "vitest";
import { getChain } from "../registry";
import { encodeBalanceOf, evmAdapter } from "./evm";
import { utxoAdapter } from "./utxo";
import { tonAdapter } from "./ton";
import { tronAdapter } from "./tron";
import { fetchAllBalances } from "./index";
import { HttpError, markRateLimited, resetCooldowns, settleSerial, withFallback } from "./http";

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

afterEach(() => {
  vi.unstubAllGlobals();
  resetCooldowns();
});

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
    expect(balances[0].raw).toBe("2500000000"); // 2.5 GRAM
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

describe("rate-limit resilience (cooldown + pacing)", () => {
  it("fails over on 429, then skips the throttled host while it cools down", async () => {
    const hits: string[] = [];
    const call = () =>
      withFallback(["https://a.test", "https://b.test"], async (base) => {
        hits.push(base);
        if (base.includes("a.test")) throw new HttpError(429, base);
        return "ok";
      });

    expect(await call()).toBe("ok");
    expect(hits).toEqual(["https://a.test", "https://b.test"]);

    // A 429 here means "suspended for tens of seconds" — retrying it on the very
    // next address would just burn the refresh, so it must be skipped.
    hits.length = 0;
    expect(await call()).toBe("ok");
    expect(hits).toEqual(["https://b.test"]);
  });

  it("still attempts a parked host when every host is cooling down", async () => {
    markRateLimited("https://a.test");
    const hits: string[] = [];
    const got = await withFallback(["https://a.test"], async (base) => {
      hits.push(base);
      return "ok";
    });
    expect(got).toBe("ok"); // better than failing without trying anything
    expect(hits).toEqual(["https://a.test"]);
  });

  it("settleSerial never overlaps items and keeps partial successes", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const out = await settleSerial([1, 2, 3], async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      if (n === 2) throw new Error("boom");
      return n;
    });
    expect(maxInFlight).toBe(1);
    expect(out).toEqual([1, 3]);
  });

  it("settleSerial throws only when every item fails", async () => {
    await expect(
      settleSerial([1, 2], async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");
  });

  it("tron adapter fetches addresses serially so a burst cannot trip the rps cap", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return {
          ok: true,
          status: 200,
          json: async () => ({ balance: 1, trc20token_balances: [] }),
        } as Response;
      }),
    );
    const trx = getChain("trx");
    await tronAdapter.fetchBalances(trx, [
      { chain: "trx", token: null, adr: "T1", title: null },
      { chain: "trx", token: null, adr: "T2", title: null },
    ]);
    expect(maxInFlight).toBe(1);
  });
});
