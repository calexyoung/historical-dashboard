import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Navigation between pages is a full document load on purpose (ADR 0015): one request,
      // one Release, nothing prefetched from an older one.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  globalIgnores([".next/**", ".builds/**", "next-env.d.ts", "test-results/**", "playwright-report/**"]),
]);
