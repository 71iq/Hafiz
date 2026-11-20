const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const { MIRROR_EXTENSION, mirrorNativeData } = require("./scripts/native-data-mirror.cjs");

// Native loaders require dataset mirrors so Metro ships them as assets, not JavaScript (RF188).
mirrorNativeData(__dirname);

const config = getDefaultConfig(__dirname);

// Add app data, animation, and web font extensions for bundled assets.
config.resolver.assetExts.push("db", "wasm", "riv", "woff", "woff2", MIRROR_EXTENSION);

// Preserve Unicode literals so bundled Arabic data stays below the JS string limit.
config.transformer.minifierConfig.output.ascii_only = false;

// zod's entry re-exports its error messages in 64 languages (208 KB) as `z.locales`. Hafiz shows its
// own Arabic and English messages and never reads that namespace, and Metro cannot drop an unused
// re-export, so the two places zod re-exports it get the English-only module instead.
const ZOD_LOCALE_INDEX = "../locales/index.js";
const ZOD_REEXPORTERS = /[\\/]node_modules[\\/]zod[\\/]v4[\\/](?:classic[\\/]external|core[\\/]index)\.js$/;
const zodEnglishLocale = path.join(__dirname, "scripts/metro-zod-locales.mjs");
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === ZOD_LOCALE_INDEX && ZOD_REEXPORTERS.test(context.originModulePath)) {
    return { type: "sourceFile", filePath: zodEnglishLocale };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./global.css", inlineRem: 16 });
