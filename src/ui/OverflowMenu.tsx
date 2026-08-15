import { useEffect, useRef, useState } from "react";

export interface MenuAction {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

// Web-native replacement for iOS swipe actions: an explicit ⋮ menu (works on
// tap and click; discoverable on every device).
export function OverflowMenu({ actions, label = "Actions" }: { actions: MenuAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        className="iconbtn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⋮
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {actions.map((a) => (
            <button
              key={a.label}
              role="menuitem"
              className={a.danger ? "danger" : undefined}
              onClick={() => {
                setOpen(false);
                a.onSelect();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
