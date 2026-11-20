// The module Metro bundles in place of zod's locale index (metro.config.js). zod registers its
// English messages itself; this keeps `z.locales.en` defined for anything that reads the namespace.
export { default as en } from "zod/v4/locales/en";
