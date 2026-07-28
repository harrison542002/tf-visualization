/**
 * Colour theme preference.
 *
 * Kept separate from the graph store because it outlives a graph: the preference persists
 * across sessions and applies to the provider step, where no graph exists yet.
 */

import { create } from "zustand";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** Shared with the pre-hydration script in `app/layout.tsx`; keep the two in step. */
export const THEME_STORAGE_KEY = "tf-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

const isPreference = (value: string | null): value is ThemePreference =>
  value === "light" || value === "dark" || value === "system";

export function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export const resolveTheme = (preference: ThemePreference): ResolvedTheme =>
  preference === "system" ? systemTheme() : preference;

/** Reads the stored preference, falling back to `system`. Safe in private-mode browsers. */
export function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export interface ThemeState {
  readonly preference: ThemePreference;
  /** What the preference works out to right now — never `system`. */
  readonly resolved: ResolvedTheme;
  readonly setPreference: (preference: ThemePreference) => void;
  /** Re-reads storage and the OS setting. Called once on mount by `ThemeProvider`. */
  readonly hydrate: () => void;
  /** Re-resolves after an OS theme change, which only matters while on `system`. */
  readonly syncSystem: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  // Server render assumes light; `hydrate` corrects it before paint via the layout script.
  preference: "system",
  resolved: "light",

  setPreference: (preference) => {
    const resolved = resolveTheme(preference);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Storage can be unavailable; the choice then lasts for this session only.
    }
    applyTheme(resolved);
    set({ preference, resolved });
  },

  hydrate: () => {
    const preference = readStoredPreference();
    const resolved = resolveTheme(preference);
    applyTheme(resolved);
    set({ preference, resolved });
  },

  syncSystem: () => {
    if (get().preference !== "system") return;
    const resolved = systemTheme();
    applyTheme(resolved);
    set({ resolved });
  },
}));
