import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored job-board aggregation module — kept as delivered (see @ts-nocheck headers).
    // Our own integration code (lib/services/jobBoardStore.ts, the ingest route) stays linted.
    "src/jobBoards/**",
  ]),
]);

export default eslintConfig;
