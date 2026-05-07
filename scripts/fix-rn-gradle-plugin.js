const fs = require("fs");
const path = require("path");

const targetPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "@react-native",
  "gradle-plugin",
  "settings.gradle.kts"
);

const from = 'plugins { id("org.gradle.toolchains.foojay-resolver-convention").version("0.5.0") }';
const to = 'plugins { id("org.gradle.toolchains.foojay-resolver-convention").version("1.0.0") }';

if (!fs.existsSync(targetPath)) {
  process.exit(0);
}

const source = fs.readFileSync(targetPath, "utf8");
if (!source.includes(from) || source.includes(to)) {
  process.exit(0);
}

fs.writeFileSync(targetPath, source.replace(from, to));
