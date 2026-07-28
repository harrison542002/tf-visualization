"use client";

import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  readonly label: string;
  readonly onSelect: () => void;
  /** Renders in red, for anything that removes work. */
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  /** Draws a divider above this item. */
  readonly separated?: boolean;
}

interface ContextMenuProps {
  readonly x: number;
  readonly y: number;
  readonly items: readonly ContextMenuItem[];
  readonly onClose: () => void;
}

/** Small popup menu positioned at the pointer, dismissed on outside click or Escape. */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as globalThis.Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      // Nudged away from the viewport edge so a right-click near the bottom stays readable.
      style={{
        left: Math.min(x, typeof window === "undefined" ? x : window.innerWidth - 200),
        top: Math.min(y, typeof window === "undefined" ? y : window.innerHeight - 200),
      }}
      className="fixed z-50 min-w-44 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      {items.map((item) => (
        <div key={item.label}>
          {item.separated && (
            <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" aria-hidden />
          )}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
            className={`w-full rounded px-2.5 py-1.5 text-left text-sm transition disabled:opacity-40 ${
              item.destructive
                ? "text-red-600 enabled:hover:bg-red-50 dark:text-red-400 dark:enabled:hover:bg-red-950"
                : "enabled:hover:bg-zinc-100 dark:enabled:hover:bg-zinc-800"
            }`}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}
