import { useRef, useState, type ChangeEvent } from "react";
import type { Asset } from "../domain/types";
import { assetId, getChain, isVerified } from "../registry";
import { useWalletStore } from "../store/walletStore";
import { shortAddress } from "../compute/format";
import { CoinIcon } from "./icons";
import { OverflowMenu } from "./OverflowMenu";
import { Dialog } from "./Dialog";
import { copyText } from "../store/toast";

function groupByChain(assets: Asset[]): [string, Asset[]][] {
  const m = new Map<string, Asset[]>();
  for (const a of assets) {
    const arr = m.get(a.chain);
    if (arr) arr.push(a);
    else m.set(a.chain, [a]);
  }
  return [...m];
}

export function ManageDialog({
  open,
  onClose,
  onRequestAdd,
}: {
  open: boolean;
  onClose: () => void;
  onRequestAdd: () => void;
}) {
  const assets = useWalletStore((s) => s.assets);
  const remove = useWalletStore((s) => s.remove);
  const updateTitle = useWalletStore((s) => s.updateTitle);
  const exportJson = useWalletStore((s) => s.exportJson);
  const importText = useWalletStore((s) => s.importText);

  const [editingAdr, setEditingAdr] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function startEdit(a: Asset) {
    setEditingAdr(a.adr);
    setEditText(a.title ?? "");
  }
  function saveEdit() {
    if (editingAdr !== null) updateTitle(editingAdr, editText);
    setEditingAdr(null);
  }

  function doExport() {
    const blob = new Blob([exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "OnlyPubs.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    e.target.value = "";
    if (assets.length === 0) {
      importText(text, "merge");
    } else {
      setPendingImport(text);
    }
  }

  const grouped = groupByChain(assets);

  return (
    <Dialog open={open} onClose={onClose} title="Manage wallets">
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className="btn" onClick={onRequestAdd} data-testid="manage-add">
          + Add
        </button>
        <button className="btn secondary" onClick={() => fileRef.current?.click()}>
          Import
        </button>
        <button className="btn secondary" onClick={doExport} data-testid="export-btn">
          Export
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={onFile}
          data-testid="import-file"
        />
      </div>

      {pendingImport !== null && (
        <div className="field" style={{ background: "var(--surface-2)", padding: 12, borderRadius: 10 }}>
          <div style={{ marginBottom: 8 }}>You already have wallets. Import as…</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn"
              onClick={() => {
                importText(pendingImport, "merge");
                setPendingImport(null);
              }}
            >
              Merge
            </button>
            <button
              className="btn danger"
              onClick={() => {
                importText(pendingImport, "replace");
                setPendingImport(null);
              }}
            >
              Replace
            </button>
            <button className="btn secondary" onClick={() => setPendingImport(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {assets.length === 0 && <p style={{ color: "var(--fg-secondary)" }}>No wallets yet.</p>}

      {grouped.map(([chainId, list]) => (
        <div key={chainId} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: "0.75rem", color: "var(--fg-secondary)", margin: "8px 0 2px" }}>
            {getChain(chainId).name}
          </div>
          {list.map((a) => {
            const id = assetId(a);
            const editing = editingAdr === a.adr;
            const confirming = confirmingId === id;
            return (
              <div key={id} className="manage-row" data-testid="manage-row">
                <CoinIcon id={a.token ?? a.chain} />
                <div className="grow">
                  {editing ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        type="text"
                        value={editText}
                        autoFocus
                        autoCapitalize="none"
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                        data-testid="edit-tag-input"
                      />
                      <button className="linkbtn" onClick={saveEdit}>
                        Save
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="name">
                        {a.title || "Untitled"}
                        {isVerified(a.adr) && (
                          <span className="crown" title="Verified">
                            {" "}
                            ♛
                          </span>
                        )}
                        {a.token && <span style={{ color: "var(--fg-secondary)" }}> · {a.token.toUpperCase()}</span>}
                      </div>
                      <div className="adr mono">{shortAddress(a.adr, 10, 8)}</div>
                    </>
                  )}
                </div>
                {confirming ? (
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      className="linkbtn"
                      style={{ color: "var(--danger)" }}
                      onClick={() => {
                        remove(id);
                        setConfirmingId(null);
                      }}
                      data-testid="confirm-delete"
                    >
                      Delete
                    </button>
                    <button className="linkbtn" onClick={() => setConfirmingId(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  !editing && (
                    <OverflowMenu
                      actions={[
                        { label: "Copy address", onSelect: () => copyText(a.adr) },
                        { label: "Edit tag", onSelect: () => startEdit(a) },
                        { label: "Delete", danger: true, onSelect: () => setConfirmingId(id) },
                      ]}
                    />
                  )
                )}
              </div>
            );
          })}
        </div>
      ))}

      <div className="links">
        <a href="https://bit.ly/onlypubs" target="_blank" rel="noopener noreferrer">
          Telegram channel
        </a>
        <a href="https://onlypubs.app/tos.html" target="_blank" rel="noopener noreferrer">
          Terms
        </a>
        <a href="https://onlypubs.app/pp.html" target="_blank" rel="noopener noreferrer">
          Privacy
        </a>
      </div>
      <p style={{ fontSize: "0.72rem", color: "var(--fg-secondary)", marginTop: 8 }}>
        Everything is stored only on this device — no cloud, no accounts.
      </p>
    </Dialog>
  );
}
