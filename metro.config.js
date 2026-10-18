const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Add app data, animation, and web font extensions for bundled assets.
config.resolver.assetExts.push("db", "wasm", "riv", "woff", "woff2");

// Preserve Unicode literals so bundled Arabic data stays below the JS string limit.
config.transformer.minifierConfig.output.ascii_only = false;

module.exports = withNativeWind(config, { input: "./global.css", inlineRem: 16 });
