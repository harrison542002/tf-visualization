"use client";

import { useMemo, useState } from "react";

import { useGraphStore } from "@/lib/graph/store";
import { compileGraph } from "@/lib/terraform/compile";
import { serializeHcl } from "@/lib/terraform/hcl";
import { serializeJson } from "@/lib/terraform/json";

export type OutputFormat = "hcl" | "json";

const FORMATS: Record<OutputFormat, { readonly label: string; readonly file: string }> = {
  hcl: { label: "HCL", file: "main.tf" },
  json: { label: "JSON", file: "main.tf.json" },
};

/** Fixed tab order, so the toggle does not depend on object key iteration. */
const FORMAT_ORDER: readonly OutputFormat[] = ["hcl", "json"];

interface GenerateDialogProps {
  readonly onClose: () => void;
}

/** Compiles the current graph and offers the result as HCL or JSON. */
export function GenerateDialog({ onClose }: GenerateDialogProps) {
  const providerId = useGraphStore((state) => state.providerId);
  const providerSettings = useGraphStore((state) => state.providerSettings);
  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);
  const selectNode = useGraphStore((state) => state.selectNode);

  const [format, setFormat] = useState<OutputFormat>("hcl");
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => {
    if (!providerId) return undefined;
    return compileGraph({ providerId, providerSettings, nodes, edges });
  }, [providerId, providerSettings, nodes, edges]);

  const output = useMemo(() => {
    if (!result?.ok) return "";
    return format === "hcl" ? serializeHcl(result.document) : serializeJson(result.document);
  }, [result, format]);

  const activeFormat = FORMATS[format];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const handleDownload = () => {
    const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = activeFormat.file;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Generated Terraform"
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="animate-pop-in flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">Generated Terraform</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Close
          </button>
        </header>

        {result && !result.ok ? (
          <div className="overflow-y-auto p-5">
            <p className="text-sm font-medium">
              Fix {result.diagnostics.length}{" "}
              {result.diagnostics.length === 1 ? "problem" : "problems"} before exporting:
            </p>
            <ul className="mt-3 space-y-1.5">
              {result.diagnostics.map((issue, index) => (
                <li
                  key={`${issue.code}-${index}`}
                  className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/40"
                >
                  {issue.nodeId ? (
                    <button
                      type="button"
                      onClick={() => {
                        selectNode(issue.nodeId ?? null);
                        onClose();
                      }}
                      className="text-left underline-offset-2 hover:underline"
                    >
                      {issue.message}
                    </button>
                  ) : (
                    issue.message
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-2 dark:border-zinc-800">
              <div className="flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
                {FORMAT_ORDER.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFormat(id)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                      id === format
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {FORMATS[id].label}
                  </button>
                ))}
              </div>
              <span className="font-mono text-xs text-zinc-500">{activeFormat.file}</span>

              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium transition hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Download
                </button>
              </div>
            </div>

            <pre className="overflow-auto bg-zinc-50 p-5 font-mono text-xs leading-relaxed dark:bg-zinc-900">
              {output}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}
