"use client";

import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from "react";

import { importTerraform, type ImportIssue, type ImportResult } from "@/lib/graph/import";
import { useGraphStore } from "@/lib/graph/store";

interface ImportDialogProps {
  readonly onClose: () => void;
}

/** Issue kinds worth grouping under one heading, in the order they matter. */
const ISSUE_LABELS: Record<ImportIssue["kind"], string> = {
  syntax: "Could not be parsed",
  "unknown-resource-type": "Resource types not in the catalog",
  "unmatched-reference": "References that could not be connected",
  "unsupported-value": "Values that were not imported",
  "unknown-attribute": "Attributes not in the schema",
  "skipped-block": "Blocks that were skipped",
};

const ISSUE_ORDER: readonly ImportIssue["kind"][] = [
  "syntax",
  "unknown-resource-type",
  "unmatched-reference",
  "unsupported-value",
  "unknown-attribute",
  "skipped-block",
];

/**
 * Paste or drop Terraform to see it as a graph.
 *
 * Deliberately two-step: parse and preview first, apply second. An import replaces the canvas,
 * so the preview is the chance to notice that half the config did not survive before it does.
 */
export function ImportDialog({ onClose }: ImportDialogProps) {
  const providerId = useGraphStore((state) => state.providerId);
  const replaceGraph = useGraphStore((state) => state.replaceGraph);

  const [source, setSource] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const preview = useCallback(
    async (text: string) => {
      if (!providerId || !text.trim()) return;
      setBusy(true);
      setError(null);
      try {
        setResult(await importTerraform({ providerId, source: text }));
      } catch (cause) {
        setError((cause as Error).message);
        console.error("import failed", cause);
      } finally {
        setBusy(false);
      }
    },
    [providerId],
  );

  const readFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      setSource(text);
      await preview(text);
    },
    [preview],
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files[0];
      if (file) void readFile(file);
    },
    [readFile],
  );

  const onPick = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) void readFile(file);
    },
    [readFile],
  );

  const apply = useCallback(() => {
    if (!result) return;
    replaceGraph({
      nodes: result.nodes,
      edges: result.edges,
      providerSettings: result.providerSettings,
    });
    onClose();
  }, [result, replaceGraph, onClose]);

  const grouped = new Map<ImportIssue["kind"], ImportIssue[]>();
  for (const issue of result?.issues ?? []) {
    const list = grouped.get(issue.kind) ?? [];
    list.push(issue);
    grouped.set(issue.kind, list);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import Terraform"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold">Import Terraform</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Paste a configuration, or drop a .tf or .tf.json file.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`rounded-lg border-2 border-dashed transition ${
              dragging
                ? "border-zinc-500 bg-zinc-50 dark:bg-zinc-900"
                : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <textarea
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
                setResult(null);
              }}
              spellCheck={false}
              aria-label="Terraform source"
              placeholder={'resource "google_compute_network" "main" {\n  name = "main"\n}'}
              className="h-56 w-full resize-none bg-transparent p-3 font-mono text-xs outline-none"
            />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void preview(source)}
              disabled={!source.trim() || busy}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {busy ? "Reading…" : "Preview"}
            </button>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm transition hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
            >
              Choose file
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".tf,.json,.tfvars,text/plain"
              onChange={onPick}
              className="hidden"
            />
            {error && <span className="text-sm text-red-600 dark:text-red-400">{error}</span>}
          </div>

          {result && (
            <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <p className="text-sm font-medium">
                {result.imported} {result.imported === 1 ? "resource" : "resources"} and{" "}
                {result.edges.length}{" "}
                {result.edges.length === 1 ? "connection" : "connections"} found.
              </p>

              {result.issues.length === 0 ? (
                <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
                  Everything in the file was imported.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {ISSUE_ORDER.filter((kind) => grouped.has(kind)).map((kind) => {
                    const list = grouped.get(kind) ?? [];
                    return (
                      <section key={kind}>
                        <h3 className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                          {ISSUE_LABELS[kind]} ({list.length})
                        </h3>
                        <ul className="mt-1 space-y-0.5">
                          {list.slice(0, 6).map((issue, index) => (
                            <li
                              key={`${kind}-${index}`}
                              className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400"
                            >
                              {issue.resource && (
                                <span className="font-mono">{issue.resource}: </span>
                              )}
                              {issue.message}
                            </li>
                          ))}
                          {list.length > 6 && (
                            <li className="text-[11px] text-zinc-400">
                              and {list.length - 6} more
                            </li>
                          )}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Importing replaces the canvas. Undo restores it.
          </p>
          <button
            type="button"
            onClick={apply}
            disabled={!result || result.imported === 0}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Add to canvas
          </button>
        </footer>
      </div>
    </div>
  );
}
