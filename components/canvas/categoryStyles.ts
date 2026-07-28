import type { ResourceCategory } from "@/lib/providers/types";

/**
 * Colour per resource category, shared by the palette and the canvas nodes so a resource
 * looks the same wherever it appears.
 */
export const CATEGORY_STYLES: Record<
  ResourceCategory,
  { readonly label: string; readonly dot: string; readonly header: string }
> = {
  network: {
    label: "Networking",
    dot: "bg-sky-500",
    header: "bg-sky-50 dark:bg-sky-950/40",
  },
  compute: {
    label: "Compute",
    dot: "bg-emerald-500",
    header: "bg-emerald-50 dark:bg-emerald-950/40",
  },
  storage: {
    label: "Storage",
    dot: "bg-amber-500",
    header: "bg-amber-50 dark:bg-amber-950/40",
  },
  iam: {
    label: "Identity",
    dot: "bg-violet-500",
    header: "bg-violet-50 dark:bg-violet-950/40",
  },
  project: {
    label: "Project",
    dot: "bg-rose-500",
    header: "bg-rose-50 dark:bg-rose-950/40",
  },
};

/** Palette section order, so categories do not shuffle between renders. */
export const CATEGORY_ORDER: readonly ResourceCategory[] = [
  "network",
  "compute",
  "storage",
  "iam",
  "project",
];
