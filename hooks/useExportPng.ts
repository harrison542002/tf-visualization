"use client";

import { useReactFlow } from "@xyflow/react";
import { useState } from "react";

import { downloadGraphPng, ExportUnavailableError } from "@/lib/graph/exportImage";
import { useGraphStore } from "@/lib/graph/store";
import { useThemeStore } from "@/lib/theme/store";

/** Painted behind exported PNGs, matching the canvas in each theme. */
const EXPORT_BACKGROUND = { light: "#ffffff", dark: "#0a0a0a" } as const;

export interface ExportPngController {
  readonly exportPng: () => void;
  readonly isExporting: boolean;
  /** Set when the last attempt failed, so the UI can say why rather than doing nothing. */
  readonly error: string | null;
  readonly dismissError: () => void;
}

/**
 * Wires the PNG export to the live canvas.
 *
 * Must be used inside `ReactFlowProvider`: only the hook form of `getNodesBounds` sees
 * measured node dimensions, and unmeasured nodes produce a box the rasteriser cannot use.
 */
export function useExportPng(): ExportPngController {
  const { getNodesBounds } = useReactFlow();
  const nodes = useGraphStore((state) => state.nodes);
  const theme = useThemeStore((state) => state.resolved);

  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportPng = () => {
    if (nodes.length === 0) {
      setError("Add a resource before exporting.");
      return;
    }

    setError(null);
    setIsExporting(true);

    void downloadGraphPng({
      bounds: getNodesBounds([...nodes]),
      backgroundColor: EXPORT_BACKGROUND[theme],
    })
      .catch((cause: unknown) => {
        setError(
          cause instanceof ExportUnavailableError
            ? cause.message
            : "Could not export the canvas as an image.",
        );
        // Keep the detail in the console: the message above is deliberately non-technical.
        console.error("PNG export failed", cause);
      })
      .finally(() => setIsExporting(false));
  };

  const dismissError = () => setError(null);

  return { exportPng, isExporting, error, dismissError };
}
