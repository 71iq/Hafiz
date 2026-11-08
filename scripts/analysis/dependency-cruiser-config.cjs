const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = path.resolve(__dirname, "../..");
const sourceExtensions = getDefaultConfig(projectRoot).resolver.sourceExts.filter((extension) =>
  ["ts", "tsx", "mjs", "js", "jsx", "json", "cjs"].includes(extension),
);
const excludedDirectories = "(^|/)(node_modules|assets|public|supabase|quran\\.com-frontend-next)(/|$)";

module.exports = function dependencyConfig(platform) {
  if (!["web", "android", "ios"].includes(platform)) {
    throw new Error(`Unsupported dependency-analysis platform: ${platform}`);
  }
  const incompatiblePlatforms =
    platform === "web" ? "native|android|ios" : platform === "android" ? "web|ios" : "web|android";
  return {
    forbidden: [
      { name: "no-cycles", severity: "error", from: {}, to: { circular: true } },
      { name: "no-unresolved", severity: "error", from: {}, to: { couldNotResolve: true } },
      { name: "domain-does-not-import-routes", severity: "error", from: { path: "^lib/" }, to: { path: "^app/" } },
      {
        name: "ui-primitives-do-not-import-routes",
        severity: "error",
        from: { path: "^components/ui/" },
        to: { path: "^app/" },
      },
    ],
    options: {
      doNotFollow: { path: excludedDirectories },
      exclude: [excludedDirectories, `\\.(${incompatiblePlatforms})\\.[cm]?[jt]sx?$`],
      tsConfig: { fileName: "tsconfig.json" },
      tsPreCompilationDeps: true,
      enhancedResolveOptions: {
        extensions: sourceExtensions.flatMap((extension) => [
          `.${platform}.${extension}`,
          ...(platform === "web" ? [] : [`.native.${extension}`]),
          `.${extension}`,
        ]),
        exportsFields: ["exports"],
        conditionNames:
          platform === "web"
            ? ["browser", "import", "require", "default"]
            : ["react-native", "import", "require", "default"],
        mainFields:
          platform === "web"
            ? ["browser", "main", "types", "typings"]
            : ["react-native", "browser", "main", "types", "typings"],
      },
    },
  };
};
