import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Root flat config, shared by every app/package in the workspace — ESLint's
// flat-config lookup walks up from cwd, so each package's `eslint .` (run
// via turbo) finds this without needing its own copy.
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/node_modules/**",
      // Next.js's own generated file (gitignored, see root .gitignore) --
      // its triple-slash reference trips @typescript-eslint's rule against
      // them. Not our code to fix; exclude it instead.
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
