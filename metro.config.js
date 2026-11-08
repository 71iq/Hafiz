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

module.exports = withNativeWind(config, { input: "./global.css", inlineRem: 16 });
