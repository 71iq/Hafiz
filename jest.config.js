module.exports = {
  preset: "jest-expo",
  transformIgnorePatterns: require("jest-expo/jest-preset").transformIgnorePatterns.map((pattern) =>
    pattern.replace("react-native|", "@rn-primitives/slot|react-native|"),
  ),
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  modulePathIgnorePatterns: ["<rootDir>/.refactor-baseline/", "<rootDir>/.ralph/"],
  setupFilesAfterEnv: ["<rootDir>/tests/jest/setup.ts"],
  testMatch: ["<rootDir>/tests/**/*.test.ts", "<rootDir>/tests/**/*.test.tsx"],
  testPathIgnorePatterns: ["/node_modules/", "/tests/e2e/"],
};
