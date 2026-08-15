import { create } from "zustand";

interface ToastState {
  message: string | null;
  show: (message: string) => void;
  hide: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useToast = create<ToastState>((set) => ({
  message: null,
  show(message) {
    if (timer) clearTimeout(timer);
    set({ message });
    timer = setTimeout(() => set({ message: null }), 1500);
  },
  hide() {
    if (timer) clearTimeout(timer);
    set({ message: null });
  },
}));

// Copy to clipboard + toast. Visual feedback replaces native haptics (plan: goal #1).
export async function copyText(text: string, toast = "Copied"): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // fallback for insecure contexts
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch {
      /* ignore */
    }
    ta.remove();
  }
  useToast.getState().show(toast);
  if ("vibrate" in navigator) {
    try {
      navigator.vibrate(10);
    } catch {
      /* not supported (e.g. iOS Safari) */
    }
  }
}
