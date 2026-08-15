import type { SectionVM } from "../domain/types";
import { usd } from "../compute/format";
import { CoinIcon, CoinIconStack } from "./icons";
import { copyText } from "../store/toast";

// Every bar is drawn on ONE consistent scale: value / grandTotal. That is what
// makes children nest inside their parent — a chain's coin bars sum exactly to
// that chain's section bar (each is its share of the whole portfolio), instead
// of each row being normalized to its own container. Ported from the iOS
// AllBarsView, where the row track = section/grandTotal and the fill =
// value/sectionTotal, which multiply to value/grandTotal.
function barWidth(value: number, grandTotal: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(grandTotal) || grandTotal <= 0) return "0%";
  return `${Math.max(0, Math.min(100, (value / grandTotal) * 100))}%`;
}

interface RowProps {
  name: string;
  icons: string[];
  coins: number;
  coinsStr: string;
  thisUsd: number;
  color: string;
  addresses: string[];
  addressSubtitle: string | null;
  grandTotal: number;
}

function Row({
  name,
  icons,
  coins,
  coinsStr,
  thisUsd,
  color,
  addresses,
  addressSubtitle,
  grandTotal,
}: RowProps) {
  const single = addresses.length === 1;
  return (
    <div
      className="tokenrow"
      data-testid="token-row"
      onClick={single ? () => copyText(addresses[0]) : undefined}
      style={{ cursor: single ? "pointer" : "default" }}
      title={single ? "Click to copy address" : undefined}
    >
      <div className="bar" style={{ width: barWidth(thisUsd, grandTotal), background: color }} />
      <div className="row">
        <CoinIconStack ids={icons} small />
        <div className="grow">
          <div className="name">{name}</div>
          {addressSubtitle && <div className="subtitle mono">{addressSubtitle}</div>}
        </div>
        <div className="amounts">
          <div className="usd num">{usd(thisUsd)}</div>
          {coins > 0 && <div className="coins num">{coinsStr}</div>}
        </div>
      </div>
    </div>
  );
}

function Section({ section, grandTotal }: { section: SectionVM; grandTotal: number }) {
  const hasRows = section.rows.length > 0;
  const showNativeRow = hasRows && !section.skipNative && section.coins > 0;
  return (
    <div className="section" data-testid="section" data-name={section.name}>
      {/* enclosing (parent) bar: this section's share of the whole portfolio */}
      <div className="bar" style={{ width: barWidth(section.totalUsd, grandTotal) }} />
      <div className="row section-head">
        <CoinIcon id={section.icon} />
        <div className="grow">
          <div className="name">{section.name}</div>
        </div>
        <div className="amounts">
          <div className="usd num">{usd(section.totalUsd)}</div>
          {!hasRows && section.coins > 0 && <div className="coins num">{section.coinsStr}</div>}
        </div>
      </div>

      {/* native coin as its own nested row (only when the section also has tokens) */}
      {showNativeRow && (
        <Row
          name={section.name}
          icons={[section.icon]}
          coins={section.coins}
          coinsStr={section.coinsStr}
          thisUsd={section.thisUsd}
          color="var(--token-bar-neutral)"
          addresses={[]}
          addressSubtitle={null}
          grandTotal={grandTotal}
        />
      )}

      {section.rows.map((r) => (
        <Row
          key={r.id}
          name={r.name}
          icons={r.icons}
          coins={r.coins}
          coinsStr={r.coinsStr}
          thisUsd={r.thisUsd}
          color={r.color}
          addresses={r.addresses}
          addressSubtitle={r.addressSubtitle}
          grandTotal={grandTotal}
        />
      ))}
    </div>
  );
}

export function WalletList({
  sections,
  grandTotal,
}: {
  sections: SectionVM[];
  grandTotal: number;
}) {
  return (
    <main className="list" data-testid="wallet-list">
      {sections.map((s) => (
        <Section key={s.id} section={s} grandTotal={grandTotal} />
      ))}
    </main>
  );
}
