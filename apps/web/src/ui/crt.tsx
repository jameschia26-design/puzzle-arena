import * as React from 'react';
import { create } from 'zustand';

const KEY = 'pa:crt';

interface CrtStore {
  on: boolean;
  toggle(): void;
}

/** Default on, persisted to localStorage under pa:crt. */
export const useCrt = create<CrtStore>((set, get) => ({
  on: (() => {
    try {
      return localStorage.getItem(KEY) !== 'off';
    } catch {
      return true;
    }
  })(),
  toggle() {
    const next = !get().on;
    set({ on: next });
    try {
      localStorage.setItem(KEY, next ? 'on' : 'off');
    } catch {
      /* private mode — the toggle still works for this session */
    }
  },
}));

/** Fixed, pointer-events:none, so it can never intercept a click. */
export function CrtLayer(): React.ReactElement | null {
  const on = useCrt((s) => s.on);
  if (!on) return null;
  return <div className="pa-crt-overlay" aria-hidden="true" />;
}

export function CrtToggle(): React.ReactElement {
  const { on, toggle } = useCrt();
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <span className="font-display text-[10px] uppercase">CRT Scanlines</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={toggle}
        className="border-2 border-pa-border w-16 min-h-[44px] flex items-center px-1 bg-pa-bg cursor-pointer"
      >
        <span
          className="h-6 w-6 border-2"
          style={{
            marginLeft: on ? 'auto' : 0,
            backgroundColor: on ? 'var(--color-pa-cyan)' : 'var(--color-pa-border)',
            borderColor: on ? 'var(--color-pa-cyan)' : 'var(--color-pa-border)',
          }}
        />
      </button>
    </label>
  );
}
