"use client";

import { useEffect, useRef, useState } from "react";

import { useGraphStore } from "@/lib/graph/store";
import { searchResources } from "@/lib/providers/search";
import { useCatalogIndex } from "@/hooks/useCatalogIndex";

/** Cap on rendered rows. The list is keyboard-driven, so a long tail helps nobody. */
const MAX_RESULTS = 40;

interface ResourceSearchProps {
  /** Called with the chosen resource type. The caller decides where it lands. */
  readonly onSelect: (resourceType: string) => void;
  readonly onClose: () => void;
}

/**
 * Search-and-add, opened from the canvas context menu.
 *
 * The palette is a browsing tool — categories, drag to place. This is the other half: you know
 * what you want, and the resource appears where you right-clicked. It searches the same index
 * the palette does, so a resource findable in one is findable in the other.
 */
export function ResourceSearch({ onSelect, onClose }: ResourceSearchProps) {
  const providerId = useGraphStore((state) => state.providerId);
  const { entries, complete, error } = useCatalogIndex(providerId);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const activeRef = useRef<HTMLButtonElement>(null);

  const results = searchResources(entries, query).slice(0, MAX_RESULTS);

  // Clamped rather than reset: the list also shrinks when the full index arrives mid-typing,
  // and a highlight past the end would leave Enter with nothing to add.
  const active = results.length === 0 ? -1 : Math.min(activeIndex, results.length - 1);

  useEffect(() => {
    // Guarded rather than called plainly: jsdom has no layout, so it does not implement this.
    activeRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const choose = (resourceType: string) => {
    onSelect(resourceType);
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      // Wraps, so holding a direction cycles rather than sticking at an end.
      setActiveIndex((active + step + results.length) % results.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const chosen = results[active];
      if (chosen) choose(chosen.type);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add a resource"
      className="animate-fade-in fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="animate-pop-in flex max-h-[60vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative border-b border-zinc-200 dark:border-zinc-800">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              // A new query means a new list, so the highlight goes back to the top of it.
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={complete ? `Search ${entries.length} resources` : "Search resources"}
            // Distinct from the palette's own search box, which can be on screen at the
            // same time: two identically-labelled searchboxes would be ambiguous.
            aria-label="Search resources to add"
            className="w-full bg-transparent py-3 pl-10 pr-3 text-sm outline-none"
          />
          <svg
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {query.trim() ? `No resources match “${query}”.` : "No resources available."}
            </p>
          ) : (
            <ul>
              {results.map((entry, index) => {
                const isActive = index === active;
                return (
                  <li key={entry.type}>
                    <button
                      ref={isActive ? activeRef : undefined}
                      type="button"
                      // Pointer and keyboard drive the same highlight, so Enter always adds
                      // whatever the eye is on.
                      onMouseMove={() => setActiveIndex(index)}
                      onClick={() => choose(entry.type)}
                      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                        isActive ? "bg-zinc-100 dark:bg-zinc-800" : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {entry.displayName}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                          {entry.type}
                        </span>
                      </span>
                      {entry.curated && (
                        <span
                          title="Has connection points"
                          className="shrink-0 rounded bg-emerald-100 px-1 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        >
                          linkable
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="border-t border-zinc-200 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          {error ?? "↑↓ to choose · Enter to add · Esc to close"}
        </footer>
      </div>
    </div>
  );
}
