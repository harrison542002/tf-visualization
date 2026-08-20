import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Deliberately without the React Compiler babel pass that `next build` applies. The compiler
  // only memoises; it changes behaviour solely for code that breaks the Rules of React, and
  // `eslint-plugin-react-hooks` fails the build for that first. Keeping it out of the test run
  // spares every test a Babel transform it would learn nothing from.
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
