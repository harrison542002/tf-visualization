"use client";

import { useEffect, useRef, useState } from "react";

import { useGraphStore } from "@/lib/graph/store";
import { getProvider, providers } from "@/lib/providers/registry";
import type { ProviderId } from "@/lib/providers/types";
import { ProviderIcon } from "./ProviderIcon";

/**
 * Header control for changing provider.
 *
 * Switching is destructive: `selectProvider` resets the graph, because a resource built from
 * one provider's catalog means nothing in another's. So a canvas with anything on it has to be
 * confirmed away first, while an empty one switches straight through — there is nothing to
 * lose there and a prompt would be pure noise.
 */
export function ProviderSwitcher() {
  const providerId = useGraphStore((state) => state.providerId);
  const selectProvider = useGraphStore((state) => state.selectProvider);
  const nodeCount = useGraphStore((state) => state.nodes.length);

  const [isOpen, setIsOpen] = useState(false);
  /** Provider awaiting confirmation, set only when the switch would discard a canvas. */
  const [pendingId, setPendingId] = useState<ProviderId | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  if (!providerId) return null;
  const current = getProvider(providerId);

  const choose = (nextId: ProviderId) => {
    setIsOpen(false);
    // Re-picking the current provider would still reset the graph, so treat it as a no-op.
    if (nextId === providerId) return;
    if (nodeCount > 0) {
      setPendingId(nextId);
      return;
    }
    selectProvider(nextId);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        title="Change provider"
        className="flex items-center gap-2 rounded-md px-2 py-1 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <ProviderIcon providerId={providerId} className="size-6" />
        <span className="text-sm font-medium">{current.displayName}</span>
        <Chevron className={isOpen ? "rotate-180" : ""} />
      </button>

      {isOpen && (
        <ul className="animate-pop-in absolute left-0 top-full z-30 mt-1 w-60 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          {providers.map((provider) => {
            const isCurrent = provider.id === providerId;
            return (
              <li key={provider.id}>
                <button
                  type="button"
                  disabled={!provider.available}
                  aria-current={isCurrent}
                  onClick={() => choose(provider.id)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left transition enabled:hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:enabled:hover:bg-zinc-800"
                >
                  <ProviderIcon
                    providerId={provider.id}
                    className={`size-6 ${provider.available ? "" : "grayscale"}`}
                  />
                  <span className="flex-1 text-sm">{provider.displayName}</span>
                  {isCurrent && <Check />}
                  {!provider.available && (
                    <span className="text-xs text-zinc-500">Coming soon</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {pendingId && (
        <SwitchWarning
          fromName={current.displayName}
          toName={getProvider(pendingId).displayName}
          nodeCount={nodeCount}
          onCancel={() => setPendingId(null)}
          onConfirm={() => {
            selectProvider(pendingId);
            setPendingId(null);
          }}
        />
      )}
    </div>
  );
}

interface SwitchWarningProps {
  readonly fromName: string;
  readonly toName: string;
  readonly nodeCount: number;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

/** Confirms a switch that would discard the canvas. */
function SwitchWarning({ fromName, toName, nodeCount, onCancel, onConfirm }: SwitchWarningProps) {
  // Built as a whole clause: "The 1 resource ... come from" would otherwise read as a typo.
  const subject =
    nodeCount === 1
      ? "The resource on this canvas comes"
      : `The ${nodeCount} resources on this canvas come`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Switch to ${toName}`}
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={onCancel}
    >
      <div
        className="animate-pop-in w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-sm font-semibold">Switch to {toName}?</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {subject} from {fromName}&rsquo;s catalog and cannot carry over. Switching clears the
          canvas, and undo will not bring it back.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-500"
          >
            Switch and clear canvas
          </button>
        </div>
      </div>
    </div>
  );
}

function Chevron({ className }: { readonly className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-3.5 text-zinc-500 transition-transform ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function Check() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 text-zinc-500"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
