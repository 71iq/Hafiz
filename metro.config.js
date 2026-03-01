const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Add sqlite extension for the MASAQ and WBW databases
config.resolver.assetExts.push("db", "wasm");

module.exports = withNativeWind(config, { input: "./global.css" });
