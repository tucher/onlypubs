import { useState } from "react";

// Ported from iOS EmptyScreenSplashCosmoView: rotating cosmonaut + tap-zoom.
export function EmptyState({ onAdd }: { onAdd: () => void }) {
  const [zoom, setZoom] = useState(false);
  return (
    <div className="empty" data-testid="empty-state">
      <div className="headline">
        ↗<br />
        JUST ADD
        <br />
        YOUR ADDRESS
      </div>
      <img
        className="cosmo"
        src={`${import.meta.env.BASE_URL}cosmo.png`}
        alt="Cosmonaut"
        style={zoom ? { transform: "scale(1.3)" } : undefined}
        onClick={() => {
          setZoom(true);
          setTimeout(() => setZoom(false), 300);
          if ("vibrate" in navigator) {
            try {
              navigator.vibrate(10);
            } catch {
              /* ignore */
            }
          }
        }}
      />
      <div className="sub">to get started</div>
      <button className="btn" style={{ maxWidth: 220 }} onClick={onAdd}>
        + Add address
      </button>
    </div>
  );
}
