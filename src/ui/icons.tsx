import { useState } from "react";
import { CHAINS, TOKENS } from "../registry";

// Brand colors used for the fallback badge when a logo image is missing
// (e.g. byTag section icons, or an id without a bundled PNG).
const ICON_COLORS: Record<string, string> = {
  btc: "#f7931a",
  eth: "#627eea",
  bnb: "#f0b90b",
  trx: "#ff060a",
  ton: "#0098ea",
  usdt: "hsl(162, 62%, 39%)",
  usdc: "hsl(210, 67%, 46%)",
  busd: "hsl(42, 86%, 58%)",
};

const LABELS: Record<string, string> = {};
for (const c of CHAINS) LABELS[c.id] = c.symbol;
for (const t of TOKENS) LABELS[t.id] = t.symbol;

const HAS_LOGO = new Set([...CHAINS.map((c) => c.id), ...TOKENS.map((t) => t.id)]);

function labelFor(id: string): string {
  return LABELS[id] ?? id.slice(0, 4).toUpperCase();
}
function colorFor(id: string): string {
  return ICON_COLORS[id] ?? "#8e8e93";
}

// Real coin logo (reused from the iOS app assets) with a colored-letter fallback.
export function CoinIcon({ id, small }: { id: string; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const cls = `coinicon${small ? " small" : ""}`;

  if (failed || !HAS_LOGO.has(id)) {
    return (
      <span className={cls} style={{ background: colorFor(id) }} data-icon={id} aria-hidden>
        {labelFor(id).slice(0, 4)}
      </span>
    );
  }
  return (
    <img
      className={cls}
      src={`${import.meta.env.BASE_URL}icons/${id}.png`}
      alt={labelFor(id)}
      data-icon={id}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

// Overlapping stack for multi-icon rows (e.g. "USDT on Tron" shows chain+token).
export function CoinIconStack({ ids, small }: { ids: string[]; small?: boolean }) {
  return (
    <span className="iconstack">
      {ids.map((id, i) => (
        <CoinIcon key={id + i} id={id} small={small} />
      ))}
    </span>
  );
}
