/**
 * Exports the canvas as a PNG.
 *
 * React Flow only renders the nodes currently in view, so a naive screenshot of the viewport
 * would clip anything scrolled off. The approach here is the one React Flow documents:
 * measure the bounds of every node, work out the transform that frames them, then rasterise
 * the viewport element with that transform applied.
 *
 * Bounds are passed in rather than computed here — they must come from the `useReactFlow`
 * hook, which is the only form that sees measured node dimensions.
 */

import { getViewportForBounds, type Rect } from "@xyflow/react";
import { toPng } from "html-to-image";

/** Padding around the content, as a fraction of the image. */
const PADDING = 0.12;
const MAX_DIMENSION = 4096;
const MIN_DIMENSION = 480;

export interface ExportImageOptions {
  /** Bounding box of every node, from `useReactFlow().getNodesBounds`. */
  readonly bounds: Rect;
  /** Painted behind the graph, since PNG has no page to fall back to. */
  readonly backgroundColor: string;
  readonly fileName?: string;
}

/**
 * True when the bounds describe a real area.
 *
 * Nodes carry no dimensions until React Flow has measured them, and a graph whose nodes are
 * all unmeasured yields a zero or non-finite box. Feeding that to `getViewportForBounds`
 * produces a NaN zoom, and a NaN transform makes the rasteriser hang rather than fail — so
 * this is checked up front and reported as a refusal instead.
 */
function isUsableBounds(bounds: Rect): boolean {
  return (
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    bounds.width > 0 &&
    bounds.height > 0
  );
}

export class ExportUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportUnavailableError";
  }
}

/** Renders the graph to a PNG data URL. Throws {@link ExportUnavailableError} if it cannot. */
export async function renderGraphToPng({
  bounds,
  backgroundColor,
}: ExportImageOptions): Promise<string> {
  const viewportElement = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!viewportElement) {
    throw new ExportUnavailableError("The canvas is not ready yet.");
  }
  if (!isUsableBounds(bounds)) {
    throw new ExportUnavailableError(
      "Nothing measurable to export yet — add a resource and let the canvas render first.",
    );
  }

  const width = Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, Math.round(bounds.width * 1.2)));
  const height = Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, Math.round(bounds.height * 1.2)));

  const viewport = getViewportForBounds(bounds, width, height, 0.5, 2, PADDING);
  if (![viewport.x, viewport.y, viewport.zoom].every(Number.isFinite)) {
    throw new ExportUnavailableError("Could not work out a viewport for the current graph.");
  }

  return toPng(viewportElement, {
    backgroundColor,
    width,
    height,
    pixelRatio: 2,
    // The page loads 17 @font-face rules; html-to-image would fetch and base64-inline every
    // one of them before rasterising, which dominates the export. Computed font-family values
    // are still copied onto the clone, so text falls back down the same stack (system-ui,
    // sans-serif) and a diagram reads fine without the webfont.
    skipFonts: true,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    },
  });
}

/** Renders and downloads the graph as a PNG. */
export async function downloadGraphPng(options: ExportImageOptions): Promise<void> {
  const dataUrl = await renderGraphToPng(options);

  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = options.fileName ?? "terraform-graph.png";
  link.click();
}
