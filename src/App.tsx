import { useEffect, useMemo, useState } from "react";
import { useWalletStore } from "./store/walletStore";
import { buildSections, grandTotal as computeGrandTotal } from "./compute/grouping";
import { usd } from "./compute/format";
import { getChain } from "./registry";
import { WalletList } from "./ui/WalletList";
import { GroupingPicker } from "./ui/GroupingPicker";
import { EmptyState } from "./ui/EmptyState";
import { Toast } from "./ui/Toast";
import { AddWalletDialog } from "./ui/AddWalletDialog";
import { ManageDialog } from "./ui/ManageDialog";

// "BTC, ETH, Securities"
function sourceNames(chains: string[], securities: boolean): string {
  const names = chains.map((id) => getChain(id).symbol);
  if (securities) names.push("Securities");
  return names.join(", ");
}

export default function App() {
  const assets = useWalletStore((s) => s.assets);
  const balances = useWalletStore((s) => s.balances);
  const rates = useWalletStore((s) => s.rates);
  const mode = useWalletStore((s) => s.groupingMode);
  const loading = useWalletStore((s) => s.loading);
  const failed = useWalletStore((s) => s.failed);
  const holdings = useWalletStore((s) => s.holdings);
  const quotes = useWalletStore((s) => s.quotes);
  const fx = useWalletStore((s) => s.fx);
  const secLoading = useWalletStore((s) => s.secLoading);
  const secFailed = useWalletStore((s) => s.secFailed);
  const lastUpdated = useWalletStore((s) => s.lastUpdated);
  const setGroupingMode = useWalletStore((s) => s.setGroupingMode);
  const check = useWalletStore((s) => s.check);

  const [showAdd, setShowAdd] = useState(false);
  const [showManage, setShowManage] = useState(false);

  const sec = useMemo(() => ({ holdings, quotes, fx }), [holdings, quotes, fx]);
  const sections = useMemo(
    () => buildSections(mode, balances, rates, sec),
    [mode, balances, rates, sec],
  );
  const total = useMemo(() => computeGrandTotal(balances, rates, sec), [balances, rates, sec]);

  // Refresh on load and whenever the tab regains focus (replaces pull-to-refresh).
  useEffect(() => {
    check(true);
    function onVisible() {
      if (document.visibilityState === "visible") check();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [check]);

  const hasWallets = assets.length > 0 || holdings.length > 0;
  const isLoading = loading.length > 0 || secLoading;
  const hasFailed = failed.length > 0 || secFailed;

  const status = isLoading
    ? `Updating ${sourceNames(loading, secLoading)}…`
    : hasFailed
      ? `Failed to update: ${sourceNames(failed, secFailed)}`
      : lastUpdated
        ? `Updated ${new Date(lastUpdated).toLocaleTimeString()}`
        : "";

  return (
    <div className="app">
      <header className="appbar">
        <button className="iconbtn" aria-label="Manage" onClick={() => setShowManage(true)} data-testid="settings-btn">
          ⚙
        </button>
        <div className="total" data-testid="grand-total">
          {hasWallets ? usd(total) : "OnlyPubs"}
        </div>
        <div className="actions">
          <button
            className={`iconbtn${isLoading ? " spinning" : ""}`}
            aria-label="Refresh"
            onClick={() => check(true)}
            data-testid="refresh-btn"
          >
            ↻
          </button>
          <button className="iconbtn" aria-label="Add" onClick={() => setShowAdd(true)} data-testid="add-btn">
            ＋
          </button>
        </div>
      </header>

      <div className="statusline" data-testid="statusline">
        <span className={hasFailed && !isLoading ? "failed" : undefined}>{status}</span>
      </div>

      {hasWallets ? (
        <WalletList sections={sections} grandTotal={total} />
      ) : (
        <EmptyState onAdd={() => setShowAdd(true)} />
      )}

      {hasWallets && <GroupingPicker mode={mode} onChange={setGroupingMode} />}

      <Toast />
      <AddWalletDialog open={showAdd} onClose={() => setShowAdd(false)} />
      <ManageDialog
        open={showManage}
        onClose={() => setShowManage(false)}
        onRequestAdd={() => setShowAdd(true)}
      />
    </div>
  );
}
