import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    ".venv/**",
    ".remember/**",
    "var/**",
    // The site lints itself with Next's rules (site/eslint.config.mjs); `npm run lint` runs both.
    "site/**",
    // v1 (untouched until cutover, ADR 0010)
    "web/**",
    "dist/**",
    "data/**",
    "**/*.generated.ts",
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs", "packages/*/bin/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly" } },
  },
]);
