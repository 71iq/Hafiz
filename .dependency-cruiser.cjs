module.exports = {
  forbidden: [
    { name: "no-cycles", severity: "warn", from: {}, to: { circular: true } },
    { name: "domain-does-not-import-routes", severity: "error", from: { path: "^lib/" }, to: { path: "^app/" } },
    {
      name: "ui-primitives-do-not-import-routes",
      severity: "error",
      from: { path: "^components/ui/" },
      to: { path: "^app/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules|assets|public|supabase|quran.com-frontend-next" },
    exclude: "(^|/)(node_modules|assets|public|supabase|quran.com-frontend-next)/",
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: [".web.ts", ".web.tsx", ".ts", ".tsx", ".js", ".json"],
      conditionNames: ["react-native", "import", "require", "default"],
    },
  },
};
