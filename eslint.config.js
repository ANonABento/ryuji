import js from "@eslint/js";
import tseslint from "typescript-eslint";

const globals = {
  Blob: "readonly",
  Buffer: "readonly",
  Bun: "readonly",
  console: "readonly",
  fetch: "readonly",
  FormData: "readonly",
  process: "readonly",
  setInterval: "readonly",
  setTimeout: "readonly",
  clearInterval: "readonly",
  clearTimeout: "readonly",
  URL: "readonly",
};

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      ".git/**",
      ".worktrees/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals,
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": "off",
      "no-unused-vars": "off",
      "no-useless-assignment": "off",
      "prefer-const": "off",
      "preserve-caught-error": "off",
    },
  },
];
