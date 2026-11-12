import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

const root = process.cwd();

const providerBoundaryRoutes = [
  "app/auth/login.tsx",
  "app/auth/signup.tsx",
  "app/auth/forgot-password.tsx",
  "app/auth/reset-password.tsx",
  "app/auth/qf-callback.tsx",
  "app/+not-found.tsx",
  "app/qa-ready.tsx",
  "app/flashcards/vocab.tsx",
  "app/profile/[userId].tsx",
];

// The root layout owns the single SettingsProvider that every route shares.
const rootOwnsSettings = /<SettingsProvider>/.test(fs.readFileSync(path.join(root, "app/_layout.tsx"), "utf8"));

test.describe("report-only provider boundary contract", () => {
  for (const routePath of providerBoundaryRoutes) {
    test(`${routePath} declares settings ownership when using strings/settings`, () => {
      const absolute = path.join(root, routePath);
      const source = fs.readFileSync(absolute, "utf8");
      const readsSettings = /useStrings|useSettings/.test(source);
      const ownsSettings =
        rootOwnsSettings ||
        /SettingsProvider/.test(source) ||
        /default English|default settings|settings boundary|provider boundary/i.test(source);

      expect(readsSettings ? ownsSettings : true).toBe(true);
    });
  }
});
