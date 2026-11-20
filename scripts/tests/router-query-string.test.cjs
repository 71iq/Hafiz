const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { test } = require("node:test");

test("Expo Router reads encoded Arabic and English links with the installed query parser", () => {
  const routerRequire = createRequire(require.resolve("expo-router/package.json"));
  const query = routerRequire("query-string");
  const params = { q: "الرحمن", reference: "2:255", label: "Page 50" };
  assert.deepEqual({ ...query.parse(query.stringify(params)) }, params);
  assert.equal(query.parse("q=verse+%26+word").q, "verse & word");
});
