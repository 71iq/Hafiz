const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const reactHooks = require("eslint-plugin-react-hooks");

const nodeGlobals = {
  __dirname: "readonly",
  Buffer: "readonly",
  console: "readonly",
  exports: "readonly",
  module: "readonly",
  process: "readonly",
  require: "readonly",
};

module.exports = defineConfig([
  {
    ignores: [
      ".expo/**",
      ".ralph/**",
      ".refactor-baseline/**",
      ".agents/**",
      ".claude/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "dist/**",
      "node_modules/**",
      "quran.com-frontend-next/**",
      "supabase/functions/**",
      "web-build/**",
    ],
  },
  ...expoConfig.map((config) =>
    config.plugins?.["react-hooks"]
      ? {
          ...config,
          plugins: { ...config.plugins, "react-hooks": reactHooks },
          rules: { ...config.rules, ...reactHooks.configs.recommended.rules },
        }
      : config,
  ),
  {
    rules: {
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/no-require-imports": "off",
      "import/no-unresolved": [
        "error",
        {
          ignore: ["^https://", "^sharp$"],
        },
      ],
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react/no-unescaped-entities": "off",
    },
  },
  {
    files: ["tests/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "react/display-name": "off",
    },
  },
  {
    files: ["*.config.js", "scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: nodeGlobals,
    },
  },
]);
