import { describe, it, expect, beforeEach } from "vitest";
import type { Asset } from "../domain/types";
import {
  loadAssets,
  saveAssets,
  exportAssets,
  parseImport,
  mergeAssets,
} from "./storage";

const A = (chain: string, token: string | null, adr: string, title: string | null = null): Asset => ({
  chain,
  token,
  adr,
  title,
});

beforeEach(() => localStorage.clear());

describe("persistence", () => {
  it("round-trips assets through localStorage", () => {
    const assets = [A("btc", null, "bc1", "cold"), A("eth", "usdt", "0x1", null)];
    saveAssets(assets);
    expect(loadAssets()).toEqual(assets);
  });

  it("returns [] when empty or corrupt", () => {
    expect(loadAssets()).toEqual([]);
    localStorage.setItem("walletwatch.assets.v1", "{not json");
    expect(loadAssets()).toEqual([]);
  });

  it("de-dupes and drops malformed entries on load", () => {
    localStorage.setItem(
      "walletwatch.assets.v1",
      JSON.stringify([
        A("btc", null, "bc1"),
        A("btc", null, "bc1"), // dup
        { adr: "nochain" }, // malformed
        { chain: "eth" }, // malformed
      ]),
    );
    expect(loadAssets()).toEqual([A("btc", null, "bc1")]);
  });

  it("export produces the iOS JSON schema", () => {
    const json = exportAssets([A("btc", null, "bc1", "cold")]);
    expect(JSON.parse(json)).toEqual([{ chain: "btc", token: null, adr: "bc1", title: "cold" }]);
  });

  it("parseImport normalizes and merge de-dupes by identity", () => {
    const incoming = parseImport(JSON.stringify([A("eth", null, "0x1"), A("btc", null, "bc1")]));
    const merged = mergeAssets([A("btc", null, "bc1", "old")], incoming);
    // btc kept once (incoming overrides), eth added
    expect(merged).toHaveLength(2);
  });
});
