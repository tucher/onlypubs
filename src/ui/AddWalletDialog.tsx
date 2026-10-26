import { useState } from "react";
import type { ChainId, TokenId } from "../domain/types";
import { CHAINS, tokensForChain } from "../registry";
import { useWalletStore } from "../store/walletStore";
import { CoinIcon } from "./icons";
import { Dialog } from "./Dialog";
import { TagField } from "./TagField";
import { SecurityForm } from "./SecurityForm";

type AddKind = "wallet" | "security";

export function AddWalletDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<AddKind>("wallet");
  return (
    <Dialog open={open} onClose={onClose} title={kind === "wallet" ? "Add address" : "Add security"}>
      <div className="segmented" role="group" aria-label="What to add" style={{ marginBottom: 14 }}>
        <button aria-pressed={kind === "wallet"} onClick={() => setKind("wallet")} data-testid="add-kind-wallet">
          Wallet
        </button>
        <button
          aria-pressed={kind === "security"}
          onClick={() => setKind("security")}
          data-testid="add-kind-security"
        >
          Security
        </button>
      </div>
      {kind === "wallet" ? <WalletForm onDone={onClose} /> : <SecurityForm onDone={onClose} />}
    </Dialog>
  );
}

function WalletForm({ onDone }: { onDone: () => void }) {
  const add = useWalletStore((s) => s.add);

  const [chain, setChain] = useState<ChainId>("btc");
  const [address, setAddress] = useState("");
  const [title, setTitle] = useState("");
  const [tokens, setTokens] = useState<TokenId[]>([]);
  const [error, setError] = useState<string | null>(null);

  const chainTokens = tokensForChain(chain);

  function reset() {
    setChain("btc");
    setAddress("");
    setTitle("");
    setTokens([]);
    setError(null);
  }

  function submit() {
    if (!address.trim()) return;
    const ok = add(address, chain, tokens, title);
    if (!ok) {
      setError("This wallet already exists.");
      return;
    }
    reset();
    onDone();
  }

  function selectChain(c: ChainId) {
    setChain(c);
    setTokens([]); // tokens depend on chain
  }

  async function paste() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setAddress(t.trim());
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <>
      <div className="field">
        <label>
          Chain
        </label>
        <div className="chips">
          {CHAINS.map((c) => (
            <button
              key={c.id}
              className="chip"
              aria-pressed={chain === c.id}
              onClick={() => selectChain(c.id)}
              data-chain={c.id}
            >
              <CoinIcon id={c.id} small /> {c.symbol}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Public key / wallet address</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            className="mono"
            placeholder="0x… / bc1… / T… public address"
            value={address}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => {
              setAddress(e.target.value);
              setError(null);
            }}
            data-testid="address-input"
          />
          <button className="btn secondary" style={{ width: "auto" }} onClick={paste}>
            Paste
          </button>
        </div>
      </div>

      {chainTokens.length > 0 && (
        <div className="field">
          <label>Tokens ({CHAINS.find((c) => c.id === chain)?.symbol})</label>
          <div className="chips">
            {chainTokens.map((t) => {
              const on = tokens.includes(t.id);
              return (
                <button
                  key={t.id}
                  className="chip"
                  aria-pressed={on}
                  data-token={t.id}
                  onClick={() =>
                    setTokens((cur) => (on ? cur.filter((x) => x !== t.id) : [...cur, t.id]))
                  }
                >
                  <CoinIcon id={t.id} small /> {t.symbol}
                  {on ? " ✓" : ""}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <TagField value={title} onChange={setTitle} placeholder="e.g. trezor / ledger / savings" />

      {error && (
        <div style={{ color: "var(--danger)", fontSize: "0.85rem", marginBottom: 10 }} role="alert">
          {error}
        </div>
      )}

      <button className="btn" disabled={!address.trim()} onClick={submit} data-testid="add-submit">
        Add
      </button>
      <p style={{ fontSize: "0.72rem", color: "var(--fg-secondary)", marginTop: 12 }}>
        Adding an address is risk-free — a public address can only be watched, never spent.
      </p>
    </>
  );
}
