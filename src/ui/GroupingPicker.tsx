import type { GroupingMode } from "../domain/types";

const MODES: { id: GroupingMode; label: string }[] = [
  { id: "byChain", label: "By Chain" },
  { id: "byToken", label: "By Coin" },
  { id: "byTag", label: "By Tag" },
];

export function GroupingPicker({
  mode,
  onChange,
}: {
  mode: GroupingMode;
  onChange: (m: GroupingMode) => void;
}) {
  return (
    <footer className="picker">
      <div className="segmented" role="group" aria-label="Grouping">
        {MODES.map((m) => (
          <button
            key={m.id}
            aria-pressed={mode === m.id}
            onClick={() => onChange(m.id)}
            data-mode={m.id}
          >
            {m.label}
          </button>
        ))}
      </div>
    </footer>
  );
}
