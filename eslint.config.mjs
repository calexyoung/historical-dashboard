import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    ".venv/**",
    ".remember/**",
    "var/**",
    // v1 (untouched until cutover, ADR 0010)
    "web/**",
    "dist/**",
    "data/**",
    "**/*.generated.ts",
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly" } },
  },
]);
