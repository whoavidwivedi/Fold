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

    // Generated. orval emits `any` in its query-param plumbing; linting it produces
    // errors we cannot fix without editing a file we must not edit. The real contract is
    // openapi.json, and CI fails if the generated client drifts from it.
    "lib/api/generated/**",

    // Written by `next dev` to keep AGENTS.md in step with the installed version.
    ".agents/**",
  ]),
]);

export default eslintConfig;
