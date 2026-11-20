module.exports = function (api) {
  // Metro bundles get the direct icon imports. Jest also announces itself as Metro (jest-expo), and
  // its mocks replace the package import, so tests keep that import as written.
  const bundling = api.caller((caller) => caller?.name === "metro") && !api.env("test");
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }]],
    plugins: bundling ? ["./scripts/babel-plugin-direct-icon-imports.cjs"] : [],
  };
};
