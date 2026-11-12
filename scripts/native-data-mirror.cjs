// Mirror assets/data/**/*.json into assets/native-data/**/*.hafizdata for native bundles (RF188).
//
// Metro decides a file is an asset by its extension, so a required .json file is compiled into the
// JavaScript bundle; the datasets made a 530 MB bundle and a 660 MB APK. The native loaders require
// the .hafizdata mirror instead, which Metro ships as a plain asset that the app reads at runtime.
// The mirror is hard links (a copy where links are unsupported), so it costs no disk space and the
// protected source files are never modified. It is generated and ignored by Git.
const fs = require("node:fs");
const path = require("node:path");

const MIRROR_EXTENSION = "hafizdata";

function mirrorNativeData(root) {
  const source = path.join(root, "assets", "data");
  const target = path.join(root, "assets", "native-data");
  let linked = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const from = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(from);
        continue;
      }
      if (!entry.name.endsWith(".json")) continue;
      const relative = path.relative(source, from);
      const to = path.join(target, relative.slice(0, -".json".length) + "." + MIRROR_EXTENSION);
      const fromStat = fs.statSync(from);
      let toStat = null;
      try {
        toStat = fs.statSync(to);
      } catch {}
      if (toStat && toStat.ino === fromStat.ino && toStat.dev === fromStat.dev) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      // Relink whenever the inode differs. A size and mtime check cannot tell a replaced source
      // from the old one when both land in the same clock tick, so it only guards the copy fallback.
      const pending = `${to}.tmp-${process.pid}`;
      fs.rmSync(pending, { force: true });
      try {
        fs.linkSync(from, pending);
        fs.renameSync(pending, to);
      } catch {
        fs.rmSync(pending, { force: true });
        if (toStat && toStat.size === fromStat.size && toStat.mtimeMs >= fromStat.mtimeMs) continue;
        fs.rmSync(to, { force: true });
        fs.copyFileSync(from, to);
      }
      linked += 1;
    }
  };
  walk(source);
  return linked;
}

module.exports = { MIRROR_EXTENSION, mirrorNativeData };

if (require.main === module) {
  const count = mirrorNativeData(path.resolve(__dirname, ".."));
  console.log(`native data mirror: ${count} file(s) updated`);
}
