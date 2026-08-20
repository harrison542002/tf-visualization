"use client";

import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useGraphStore } from "@/lib/graph/store";
import { providers } from "@/lib/providers/registry";
import { ProviderIcon } from "./ProviderIcon";

/**
 * Thousands separators, with the locale pinned.
 *
 * This text is server-rendered and then hydrated, so a bare `toLocaleString()` would risk the
 * server's locale disagreeing with the browser's and tripping a hydration mismatch.
 */
const formatCount = (value: number): string => value.toLocaleString("en-US");

/** Step one of the flow: choose which cloud to build for. */
export function ProviderStep() {
  const selectProvider = useGraphStore((state) => state.selectProvider);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 flex justify-end">
        <ThemeToggle />
      </div>

      <h1 className="text-3xl font-semibold tracking-tight">Choose a cloud provider</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Pick a provider to start laying out resources. You can export the result as Terraform
        HCL or JSON at any point.
      </p>

      <ul className="mt-8 grid gap-4 sm:grid-cols-3">
        {providers.map((provider) => (
          <li key={provider.id}>
            <button
              type="button"
              disabled={!provider.available}
              onClick={() => selectProvider(provider.id)}
              className="flex h-full w-full flex-col items-start gap-3 rounded-xl border border-zinc-200 bg-white p-5 text-left transition enabled:hover:border-zinc-400 enabled:hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:enabled:hover:border-zinc-600"
            >
              {/* Every mark occupies the same square, so the cards agree with each other.
                  Unavailable providers lose their colour, so the card reads as inactive at a
                  glance rather than only via the label. */}
              <ProviderIcon
                providerId={provider.id}
                className={`size-10 ${provider.available ? "" : "grayscale"}`}
              />
              <div>
                <span className="block text-base font-medium">{provider.displayName}</span>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {provider.available
                    ? `${formatCount(provider.catalogSize)} resources`
                    : "Coming soon"}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
