"use client";

import { useEffect } from "react";

import { useThemeStore, type ThemePreference } from "@/lib/theme/store";

/**
 * Applies the stored theme and keeps it in step with the OS setting.
 *
 * The class itself is set before paint by the inline script in `app/layout.tsx`; this only
 * takes over once React is running, so there is no flash on load.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const hydrate = useThemeStore((state) => state.hydrate);
  const syncSystem = useThemeStore((state) => state.syncSystem);

  useEffect(() => {
    hydrate();
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", syncSystem);
    return () => query.removeEventListener("change", syncSystem);
  }, [hydrate, syncSystem]);

  return <>{children}</>;
}

const OPTIONS: readonly { readonly id: ThemePreference; readonly label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

const ICONS: Record<ThemePreference, React.ReactNode> = {
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  dark: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  system: (
    <>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </>
  ),
};

/** Three-way light / dark / system switch. */
export function ThemeToggle() {
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={preference === option.id}
          aria-label={option.label}
          title={option.label}
          onClick={() => setPreference(option.id)}
          className={`rounded p-1.5 transition ${
            preference === option.id
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {ICONS[option.id]}
          </svg>
        </button>
      ))}
    </div>
  );
}
