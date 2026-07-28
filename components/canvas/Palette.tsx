"use client";

import { useMemo, useRef, useState } from "react";

import { useGraphStore } from "@/lib/graph/store";
import { getProvider } from "@/lib/providers/registry";
import { filterResources } from "@/lib/providers/search";
import type { ResourceCategory, ResourceSchema } from "@/lib/providers/types";
import { CATEGORY_ORDER, CATEGORY_STYLES } from "./categoryStyles";

/** Key the drag payload travels under. Read by the canvas in `onDrop`. */
export const RESOURCE_DRAG_TYPE = "application/tf-visualization-resource";

/** Resource list, searchable and grouped by category, dragged onto the canvas. */
export function Palette() {
  const providerId = useGraphStore((state) => state.providerId);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const provider = providerId ? getProvider(providerId) : undefined;
  const matches = useMemo(
    () => (provider ? filterResources(provider.resources, query) : []),
    [provider, query],
  );

  const grouped = useMemo(() => {
    const byCategory = new Map<ResourceCategory, ResourceSchema[]>();
    for (const resource of matches) {
      const existing = byCategory.get(resource.category);
      if (existing) existing.push(resource);
      else byCategory.set(resource.category, [resource]);
    }
    return byCategory;
  }, [matches]);

  if (!provider) return null;

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">Resources</h2>
        <div className="relative mt-2">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
            placeholder="Search resources"
            aria-label="Search resources"
            className="w-full rounded-md border border-zinc-300 bg-white py-1.5 pl-7 pr-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
          />
          <svg
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
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
        <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          {query
            ? `${matches.length} of ${provider.resources.length} shown`
            : "Drag onto the canvas to add."}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {matches.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No resources match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          CATEGORY_ORDER.filter((category) => grouped.has(category)).map((category) => (
            <section key={category} className="mb-4 last:mb-0">
              <h3 className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                <span
                  className={`size-2 rounded-full ${CATEGORY_STYLES[category].dot}`}
                  aria-hidden
                />
                {CATEGORY_STYLES[category].label}
              </h3>
              <ul className="space-y-1">
                {(grouped.get(category) ?? []).map((resource) => (
                  <li key={resource.type}>
                    <div
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData(RESOURCE_DRAG_TYPE, resource.type);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      title={resource.description}
                      className="cursor-grab rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-sm transition hover:border-zinc-400 active:cursor-grabbing dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
                    >
                      <p className="font-medium">{resource.displayName}</p>
                      <p className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                        {resource.type}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </aside>
  );
}
