import { useMemo } from "react";
import { useWalletStore } from "../store/walletStore";

// Tag input with completions from every tag in use — wallets and securities
// share tags, so a broker's holdings can sit next to a hardware wallet.
export function TagField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const assets = useWalletStore((s) => s.assets);
  const holdings = useWalletStore((s) => s.holdings);

  const suggestions = useMemo(() => {
    const set = new Set<string>();
    for (const a of assets) if (a.title) set.add(a.title);
    for (const h of holdings) if (h.title) set.add(h.title);
    const q = value.trim().toLowerCase();
    return [...set].filter((t) => t.toLowerCase().startsWith(q) && t.toLowerCase() !== q).slice(0, 6);
  }, [assets, holdings, value]);

  return (
    <div className="field">
      <label>Tag (optional)</label>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        autoCapitalize="none"
        onChange={(e) => onChange(e.target.value)}
        data-testid="tag-input"
      />
      {suggestions.length > 0 && (
        <div className="chips" style={{ marginTop: 8 }}>
          {suggestions.map((t) => (
            <button key={t} className="chip" onClick={() => onChange(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
