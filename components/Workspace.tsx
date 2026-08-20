"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useState } from "react";

import { Canvas } from "@/components/canvas/Canvas";
import { Palette } from "@/components/canvas/Palette";
import { useExportPng } from "@/hooks/useExportPng";
import { GenerateDialog } from "@/components/generate/GenerateDialog";
import { PropertiesPanel } from "@/components/panel/PropertiesPanel";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { ProviderStep } from "@/components/wizard/ProviderStep";
import { ProviderSwitcher } from "@/components/wizard/ProviderSwitcher";
import { useGraphStore } from "@/lib/graph/store";

function isEditingText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function Workspace() {
  const providerId = useGraphStore((state) => state.providerId);

  if (!providerId) return <ProviderStep />;

  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}

function Editor() {
  const providerId = useGraphStore((state) => state.providerId);
  const nodeCount = useGraphStore((state) => state.nodes.length);
  const undo = useGraphStore((state) => state.undo);
  const redo = useGraphStore((state) => state.redo);
  const canUndo = useGraphStore((state) => state.past.length > 0);
  const canRedo = useGraphStore((state) => state.future.length > 0);

  const { exportPng, isExporting, error, dismissError } = useExportPng();
  const [showGenerate, setShowGenerate] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditingText(event.target)) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;

      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  if (!providerId) return null;

  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <ProviderSwitcher />
        <span className="text-xs text-zinc-500">
          {nodeCount} {nodeCount === 1 ? "resource" : "resources"}
        </span>

        <div className="ml-2 flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
          <HistoryButton label="Undo" hint="Ctrl+Z" disabled={!canUndo} onClick={undo}>
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
          </HistoryButton>
          <HistoryButton label="Redo" hint="Ctrl+Shift+Z" disabled={!canRedo} onClick={redo}>
            <path d="M21 7v6h-6" />
            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
          </HistoryButton>
        </div>

        {error && (
          <button
            type="button"
            onClick={dismissError}
            title="Dismiss"
            className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
          >
            {error}
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={exportPng}
            disabled={nodeCount === 0 || isExporting}
            className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm font-medium transition enabled:hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-800 dark:enabled:hover:bg-zinc-800"
          >
            {isExporting ? "Exporting…" : "Export PNG"}
          </button>
          <button
            type="button"
            onClick={() => setShowGenerate(true)}
            disabled={nodeCount === 0}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Generate Terraform
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Palette />
        <Canvas />
        <PropertiesPanel />
      </div>

      {showGenerate && <GenerateDialog onClose={() => setShowGenerate(false)} />}
    </div>
  );
}

function HistoryButton({
  label,
  hint,
  disabled,
  onClick,
  children,
}: {
  label: string;
  hint: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={`${label} (${hint})`}
      className="rounded p-1.5 text-zinc-600 transition enabled:hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-400 dark:enabled:hover:bg-zinc-800"
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
        {children}
      </svg>
    </button>
  );
}
