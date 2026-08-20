import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // React Compiler memoises components and hooks at build time, which is why there is no
  // hand-written `useMemo`, `useCallback` or `memo` in this codebase. See CLAUDE.md.
  reactCompiler: true,
};

export default nextConfig;
