import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/", "coverage/", "src-tauri/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["*.js", "*.ts", "scripts/**"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // `_`-prefixed names are intentionally unused (destructuring omit, mock signatures).
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    // The Markdown pipeline deliberately uses NUL placeholders and invisible/zero-width characters
    // in regexes and literals; rewriting them would risk changing behaviour.
    files: ["src/markdown/**/*.ts"],
    rules: {
      "no-control-regex": "off",
      "no-irregular-whitespace": "off",
      "no-misleading-character-class": "off",
    },
  },
  {
    // Tests mock Tauri/DOM APIs with loose types and use literal Windows paths in strings:
    // typing/rewriting all of it would be churn without value.
    files: ["src/**/*.test.ts", "src/test-support/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-useless-escape": "off",
    },
  },
);
