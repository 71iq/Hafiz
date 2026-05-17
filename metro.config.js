const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Add app data and animation extensions for bundled assets.
config.resolver.assetExts.push("db", "wasm", "riv");

module.exports = withNativeWind(config, { input: "./global.css" });
