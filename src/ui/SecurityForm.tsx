import { useEffect, useState } from "react";
import type { Quote, SecurityKind, SecurityMeta } from "../domain/types";
import { LookupError, lookupIsin, type LookupFailure } from "../adapters";
import { isValidIsin, normalizeIsin } from "../compute/isin";
import { quoteValue, toUsd } from "../compute/securities";
import { parseAmount, usd } from "../compute/format";
import { useWalletStore } from "../store/walletStore";
import { TagField } from "./TagField";

const KIND_LABELS: Record<SecurityKind, string> = {
  stock: "Stock",
  etf: "ETF",
  fund: "Fund",
  bond: "Bond",
};

const LOOKUP_MESSAGES: Record<LookupFailure, string> = {
  notFound: "No stock, ETF, fund or bond found for this ISIN.",
  rateLimited: "The lookup service is limiting requests. Try again in a few minutes.",
  failed: "Lookup failed. Check your connection and try again.",
};

type LookupState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "found"; meta: SecurityMeta; quote: Quote }
  | { status: "error"; message: string };

const amountFmt = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// A plain number + code rather than Intl's currency style, which would read a
// minor unit like "GBp" (pence) as pounds.
function priceLabel(q: Quote): string {
  if (!q.percent) return `${amountFmt.format(q.price)} ${q.currency}`;
  const clean = `${amountFmt.format(q.price)} %`;
  // zero-coupon bonds accrue nothing — no need to say so
  return q.accrued ? `${clean} + ${amountFmt.format(q.accrued)} % accrued` : clean;
}

export function SecurityForm({ onDone }: { onDone: () => void }) {
  const addHolding = useWalletStore((s) => s.addHolding);
  const ensureFx = useWalletStore((s) => s.ensureFx);
  const fx = useWalletStore((s) => s.fx);

  const [isinText, setIsinText] = useState("");
  const [qtyText, setQtyText] = useState("");
  const [title, setTitle] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);

  const isin = normalizeIsin(isinText);
  const valid = isValidIsin(isin);
  const qty = parseAmount(qtyText);
  const qtyOk = Number.isFinite(qty) && qty > 0;

  // Only a checksum-valid ISIN is looked up: typing yields at most one, and a
  // typo never spends a request on the rate-limited lookup.
  useEffect(() => {
    if (!valid) {
      setLookup({ status: "idle" });
      return;
    }
    const ctl = new AbortController();
    setLookup({ status: "loading" });
    ensureFx();
    lookupIsin(isin, ctl.signal).then(
      ({ meta, quote }) => {
        if (!ctl.signal.aborted) setLookup({ status: "found", meta, quote });
      },
      (e) => {
        if (ctl.signal.aborted) return;
        const reason = e instanceof LookupError ? e.reason : "failed";
        setLookup({ status: "error", message: LOOKUP_MESSAGES[reason] });
      },
    );
    return () => ctl.abort();
  }, [isin, valid, ensureFx]);

  const found = lookup.status === "found" ? lookup : null;
  const isBond = found?.meta.kind === "bond";

  function reset() {
    setIsinText("");
    setQtyText("");
    setTitle("");
    setError(null);
  }

  function submit() {
    if (!found || !qtyOk) return;
    if (!addHolding(isin, qty, title, found.meta, found.quote)) {
      setError("This security is already listed with this tag — change its quantity in Manage.");
      return;
    }
    reset();
    onDone();
  }

  async function paste() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setIsinText(t.trim());
    } catch {
      /* clipboard blocked */
    }
  }

  let sum: string | null = null;
  if (found && qtyOk) {
    const value = quoteValue(qty, found.quote);
    const inUsd = toUsd(value, found.quote.currency, fx);
    const local = `${amountFmt.format(value)} ${found.quote.currency}`;
    if (found.quote.currency === "USD") sum = `= ${usd(value)}`;
    else sum = inUsd === null ? `= ${local}` : `= ${local} ≈ ${usd(inUsd)}`;
  }

  return (
    <>
      <div className="field">
        <label>ISIN</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            className="mono"
            placeholder="e.g. IE00B5BMR087"
            value={isinText}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => {
              setIsinText(e.target.value);
              setError(null);
            }}
            data-testid="isin-input"
          />
          <button className="btn secondary" style={{ width: "auto" }} onClick={paste}>
            Paste
          </button>
        </div>
        <div className="lookup" data-testid="isin-status">
          {!valid && isin.length >= 12 && (
            <span className="lookup-error">Not a valid ISIN — check for a typo.</span>
          )}
          {lookup.status === "loading" && <span>Looking up…</span>}
          {lookup.status === "error" && <span className="lookup-error">{lookup.message}</span>}
          {found && (
            <div data-testid="security-preview">
              <div className="lookup-name">{found.meta.name}</div>
              <div>
                {KIND_LABELS[found.meta.kind]} · {priceLabel(found.quote)} · {found.quote.venue}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="field">
        <label>{isBond ? `Nominal (${found?.meta.currency})` : "Quantity"}</label>
        <input
          type="text"
          inputMode="decimal"
          placeholder={isBond ? "e.g. 10000" : "e.g. 10"}
          value={qtyText}
          onChange={(e) => {
            setQtyText(e.target.value);
            setError(null);
          }}
          data-testid="qty-input"
        />
        {sum && (
          <div className="lookup num" data-testid="security-sum">
            {sum}
          </div>
        )}
      </div>

      <TagField value={title} onChange={setTitle} placeholder="e.g. broker / bank / pension" />

      {error && (
        <div style={{ color: "var(--danger)", fontSize: "0.85rem", marginBottom: 10 }} role="alert">
          {error}
        </div>
      )}

      <button className="btn" disabled={!found || !qtyOk} onClick={submit} data-testid="add-submit">
        Add
      </button>
      <p style={{ fontSize: "0.72rem", color: "var(--fg-secondary)", marginTop: 12 }}>
        Prices come from Tradegate and Onvista and may be delayed. Nothing about your holdings
        leaves this device except the ISIN being priced.
      </p>
    </>
  );
}
