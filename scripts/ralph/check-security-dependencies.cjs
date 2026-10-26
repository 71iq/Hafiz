// Verify the dependency instances used by the existing devtools and CLI.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { pipeline } = require("node:stream/promises");
const { createGunzip } = require("node:zlib");

async function main() {
  const reactNative = createRequire(require.resolve("react-native/package.json"));
  const devtools = createRequire(reactNative.resolve("react-devtools-core/package.json"));
  const cli = createRequire(require.resolve("supabase/package.json"));
  assert.equal(devtools("shell-quote/package.json").version, "1.12.0");
  const tarMetadata = cli("tar/package.json");
  assert.equal(tarMetadata.version, "7.5.22");
  const quote = devtools("shell-quote").quote;
  // Only call the quoting function. Never execute its output in a shell.
  assert.throws(() => quote(["echo", "ok", { comment: "fixture" }, "a\nid;#"]), TypeError);

  const reports = path.resolve(__dirname, "../../.refactor-baseline");
  fs.mkdirSync(reports, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(reports, "security-dependencies-"));
  const input = path.join(fixture, "input");
  const output = path.join(fixture, "output");
  fs.mkdirSync(input);
  fs.mkdirSync(output);
  const contents = "Harmless installer API fixture.\n";
  fs.writeFileSync(path.join(input, "supabase"), contents);
  const archive = path.join(fixture, "fixture.tar.gz");
  const esmEntry = tarMetadata.exports["."].import.default;
  assert.equal(typeof esmEntry, "string");
  assert.match(esmEntry, /^\.\//);
  const tarDirectory = path.dirname(cli.resolve("tar/package.json"));
  const tar = await import(pathToFileURL(path.resolve(tarDirectory, esmEntry)).href);
  assert.equal(typeof tar.extract, "function");
  await tar.create({ cwd: input, file: archive, gzip: true }, ["supabase"]);
  // Match the CLI installer's gunzip and extract(options, files) usage.
  await pipeline(fs.createReadStream(archive), createGunzip(), tar.extract({ cwd: output }, ["supabase"]));
  assert.equal(fs.readFileSync(path.join(output, "supabase"), "utf8"), contents);
  console.log("Patched parent-resolved versions, safe quoting rejection, and installer archive API passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
