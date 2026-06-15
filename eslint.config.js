const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

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
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "quran.com-frontend-next/**",
      "supabase/functions/**",
      "web-build/**",
    ],
  },
  ...expoConfig,
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
