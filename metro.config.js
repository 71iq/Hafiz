const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const { MIRROR_EXTENSION, mirrorNativeData } = require("./scripts/native-data-mirror.cjs");

mirrorNativeData(__dirname);

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push("db", "wasm", "riv", "woff", "woff2", MIRROR_EXTENSION);

config.transformer.minifierConfig.output.ascii_only = false;

module.exports = withNativeWind(config, { input: "./global.css", inlineRem: 16 });
