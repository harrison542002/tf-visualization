"use client";

import { useState } from "react";

import { useGraphStore } from "@/lib/graph/store";
import { getProvider } from "@/lib/providers/registry";
import { searchResources } from "@/lib/providers/search";
import type { ResourceCategory, ResourceSchema } from "@/lib/providers/types";
import { CATEGORY_ORDER, CATEGORY_STYLES } from "./categoryStyles";
import { useCatalogIndex } from "@/hooks/useCatalogIndex";

/** Key the drag payload travels under. Read by the canvas in `onDrop`. */
export const RESOURCE_DRAG_TYPE = "application/tf-visualization-resource";

/** Cap on rendered search results; a bare "a" would otherwise match a thousand rows. */
const MAX_RESULTS = 60;

/** Ties the collapse buttons to the region they show and hide. */
const PANEL_ID = "resource-palette";

/** Stable empty, so an absent provider does not hand a fresh array to the compiler's cache. */
const NO_RESOURCES: readonly ResourceSchema[] = [];

/**
 * Resource list.
 *
 * With no query this shows the curated tier-1 set, which is bundled and instant. Searching
 * reaches the full catalog index — around 1300 resources per provider — fetched once when the
 * provider is chosen. Dropping a non-curated resource fetches its schema on demand.
 *
 * Collapsible, because the canvas is the point: hidden, it leaves a narrow rail holding the
 * button that brings it back.
 */
export function Palette() {
  const providerId = useGraphStore((state) => state.providerId);
  const loadingTypes = useGraphStore((state) => state.loadingTypes);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(true);

  const { entries, complete, error: indexError } = useCatalogIndex(providerId);
  const provider = providerId ? getProvider(providerId) : undefined;
  const curated = provider?.resources ?? NO_RESOURCES;

  const results = query.trim() ? searchResources(entries, query) : [];

  const grouped = new Map<ResourceCategory, typeof curated>();
  for (const resource of curated) {
    const existing = grouped.get(resource.category);
    if (existing) grouped.set(resource.category, [...existing, resource]);
    else grouped.set(resource.category, [resource]);
  }

  if (!provider) return null;
  const searching = query.trim().length > 0;

  return (
    <aside
      // The width animates while the contents cross-fade. The inner column holds its full
      // width throughout, so the text is clipped rather than reflowing on every frame.
      className={`relative flex shrink-0 flex-col overflow-hidden border-r border-zinc-200 bg-zinc-50 motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out dark:border-zinc-800 dark:bg-zinc-900 ${
        isOpen ? "w-64" : "w-11"
      }`}
    >
      {/* Sits under the panel and fades in behind it, so the rail has a control the moment
          there is room for one. */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Show resources"
        aria-expanded={isOpen}
        aria-controls={PANEL_ID}
        title="Show resources"
        className={`absolute left-0 top-0 flex size-11 items-center justify-center text-zinc-500 transition-opacity duration-150 hover:text-zinc-900 dark:hover:text-zinc-100 ${
          isOpen ? "pointer-events-none opacity-0" : "opacity-100 delay-100"
        }`}
      >
        <PanelIcon direction="right" />
      </button>

      <div
        id={PANEL_ID}
        inert={!isOpen}
        className={`flex w-64 flex-1 flex-col overflow-hidden transition-opacity duration-150 ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Resources</h2>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Hide resources"
              aria-expanded={isOpen}
              aria-controls={PANEL_ID}
              title="Hide resources"
              className="-mr-1 rounded p-1 text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <PanelIcon direction="left" />
            </button>
          </div>

          <div className="relative mt-2">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
              }}
              placeholder={complete ? `Search ${entries.length} resources` : "Search resources"}
              aria-label="Search resources"
              className="w-full rounded-md border border-zinc-300 bg-white py-1.5 pl-7 pr-2 text-sm outline-none transition focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
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
            {indexError
              ? indexError
              : searching
                ? `${results.length}${results.length > MAX_RESULTS ? `, showing ${MAX_RESULTS}` : ""} found`
                : "Drag onto the canvas to add."}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {searching ? (
            results.length === 0 ? (
              <p className="px-1 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                No resources match &ldquo;{query}&rdquo;.
              </p>
            ) : (
              <ul className="space-y-1">
                {results.slice(0, MAX_RESULTS).map((entry) => (
                  <li key={entry.type}>
                    <ResourceCard
                      type={entry.type}
                      displayName={entry.displayName}
                      description={entry.description}
                      curated={entry.curated}
                      slots={entry.slots}
                      loading={loadingTypes.includes(entry.type)}
                    />
                  </li>
                ))}
              </ul>
            )
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
                      <ResourceCard
                        type={resource.type}
                        displayName={resource.displayName}
                        description={resource.description}
                        curated
                        slots={resource.slots.length}
                        loading={loadingTypes.includes(resource.type)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

/** Sidebar glyph, with the direction the panel will move marked inside it. */
function PanelIcon({ direction }: { readonly direction: "left" | "right" }) {
  return (
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
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M10 4v16" />
      {direction === "left" ? <path d="m16 10-2 2 2 2" /> : <path d="m14 10 2 2-2 2" />}
    </svg>
  );
}

interface ResourceCardProps {
  readonly type: string;
  readonly displayName: string;
  readonly description: string;
  readonly curated: boolean;
  /** Connection points. Zero means the resource can only ever stand alone. */
  readonly slots: number;
  readonly loading: boolean;
}

function ResourceCard({ type, displayName, description, curated, slots, loading }: ResourceCardProps) {
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(RESOURCE_DRAG_TYPE, type);
        event.dataTransfer.effectAllowed = "move";
      }}
      title={description || type}
      className="cursor-grab rounded-md border border-zinc-200 bg-white px-2.5 py-2 text-sm transition hover:border-zinc-400 active:cursor-grabbing dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
    >
      <p className="flex items-center gap-1.5 font-medium">
        <span className="truncate">{displayName}</span>
        {slots > 0 && (
          <span
            title={`${slots} connection point${slots === 1 ? "" : "s"}${curated ? ", hand-curated" : ""}`}
            className="shrink-0 rounded bg-emerald-100 px-1 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          >
            {slots}
          </span>
        )}
        {loading && <span className="shrink-0 text-[10px] text-zinc-400">loading…</span>}
      </p>
      <p className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{type}</p>
    </div>
  );
}
