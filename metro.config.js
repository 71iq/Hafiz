const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Add app data, animation, and web font extensions for bundled assets.
config.resolver.assetExts.push("db", "wasm", "riv", "woff", "woff2");

module.exports = withNativeWind(config, { input: "./global.css", inlineRem: 16 });
