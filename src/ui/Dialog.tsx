import { useEffect, useRef, type ReactNode } from "react";

// Native <dialog> wrapper: focus-trapped, Esc + backdrop close, and (via CSS)
// a bottom sheet on narrow viewports / centered dialog on wide ones.
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      className="sheet"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // backdrop click closes
      }}
    >
      <div className="sheet-head">
        <span>{title}</span>
        <button className="iconbtn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="sheet-body">{children}</div>
    </dialog>
  );
}
