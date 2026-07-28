import { useId } from "react";

import type { ProviderId } from "@/lib/providers/types";

/**
 * Brand-tinted cloud glyph for a provider.
 *
 * Deliberately a generic cloud in each provider's signature colours rather than a redrawn
 * corporate logo: it keeps the marks out of the repository, stays legible at small sizes, and
 * needs no external asset — the whole app renders offline.
 *
 * Presentation lives here rather than on `ProviderDefinition` so the catalog stays pure data.
 */

const CLOUD_PATH =
  "M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z";

/** Stops for each provider's gradient, in order. A single stop renders as a flat fill. */
const GRADIENTS: Record<ProviderId, readonly string[]> = {
  // Google's four brand colours, swept across the shape.
  gcp: ["#4285F4", "#EA4335", "#FBBC04", "#34A853"],
  aws: ["#FF9900", "#EC7211"],
  azure: ["#50E6FF", "#0078D4"],
};

interface ProviderIconProps {
  readonly providerId: ProviderId;
  readonly className?: string;
}

export function ProviderIcon({ providerId, className }: ProviderIconProps) {
  // Gradient ids are document-global, so they must be unique per rendered instance.
  const gradientId = useId();
  const stops = GRADIENTS[providerId];

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          {stops.map((color, index) => (
            <stop
              key={color}
              offset={stops.length === 1 ? 0 : index / (stops.length - 1)}
              stopColor={color}
            />
          ))}
        </linearGradient>
      </defs>
      <path d={CLOUD_PATH} fill={`url(#${gradientId})`} />
    </svg>
  );
}
