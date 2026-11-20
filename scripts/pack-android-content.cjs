// Store each offline resource independently so opening a page only decompresses its own font.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { zstdCompressSync, zstdDecompressSync, constants } = require("node:zlib");

const assets = path.resolve(__dirname, "../assets");
const out = path.join(path.resolve(process.argv[2]), "reader");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const digest = (bytes, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex");

function pack(from, to) {
  const original = fs.readFileSync(from);
  const compressed = zstdCompressSync(original, { params: { [constants.ZSTD_c_compressionLevel]: 12 } });
  if (!zstdDecompressSync(compressed).equals(original)) throw new Error("Packing failed: " + from);
  const file = path.join(out, to + ".zst");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, compressed);
}

const classic = [];
for (let page = 1; page <= 604; page++) {
  const name = "p" + page + ".ttf";
  pack(path.join(assets, "fonts/QPC_V4_TAJWEED", name), "v4/" + name);
  // The web export already serves these original files at Metro's content-hashed URLs.
  const bytes = fs.readFileSync(path.join(assets, "fonts/QPC_V2", name));
  classic.push({ urlHash: digest(bytes, "md5"), sha256: digest(bytes), size: bytes.length });
}
const tafsir = {};
for (const source of fs.readdirSync(path.join(assets, "data/tafsir-sources"))) {
  const hashes = [];
  for (let surah = 1; surah <= 114; surah++) {
    const raw = fs.readFileSync(path.join(assets, "data/tafsir-sources", source, surah + ".json"));
    hashes.push({ sha256: digest(raw), size: raw.length });
  }
  tafsir[source] = hashes;
}
fs.writeFileSync(path.join(out, "downloads.json"), JSON.stringify({
  classic, tafsir,
}));

const data = path.join(assets, "data");
const files = [
  ...fs.readdirSync(data).filter((name) => name.endsWith(".json")),
  "quran.db", "layout/page-lines.json", "wbw/wbw.json", "masaq/masaq-aggregated.json",
  "mutashabihat/nourquran_hafiz_rows.json",
];
for (const dir of ["translations", "tafseer"]) {
  for (const name of fs.readdirSync(path.join(data, dir))) {
    if (name.endsWith(".json")) files.push(path.join(dir, name));
  }
}
for (const name of files) pack(path.join(data, name), "data/" + name);

fs.writeFileSync(path.join(out, "classic-version"), digest(JSON.stringify(classic)));
