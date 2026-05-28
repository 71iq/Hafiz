import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const clientRoots = ["app", "components", "lib"];
const forbiddenClientSecretNames = [
  "QF_CONTENT_CLIENT_SECRET",
  "QF_CLIENT_SECRET",
  "SUPABASE_SERVICE_ROLE",
  "service_role",
];

function walkFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolute));
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(absolute);
    }
  }

  return files;
}

describe("client safety contracts", () => {
  it("does not expose backend-only QF or Supabase secrets in client code", () => {
    const hits: string[] = [];
    for (const rootDir of clientRoots) {
      for (const file of walkFiles(path.join(root, rootDir))) {
        const relativePath = path.relative(root, file);
        const source = fs.readFileSync(file, "utf8");
        for (const secretName of forbiddenClientSecretNames) {
          if (source.includes(secretName)) hits.push(`${relativePath}: ${secretName}`);
        }
      }
    }

    expect(hits).toEqual([]);
  });

  it("keeps web static data preparation covering runtime-fetched datasets", () => {
    const script = fs.readFileSync(path.join(root, "scripts/prepare-web-data.sh"), "utf8");
    for (const requiredCopy of [
      "surah-info.json",
      "wbw-arabic-meanings.json",
      "irab-per-word.json",
      "tajweed-rules-ar.json",
      "tajweed-rules-en.json",
      "page-words.json",
      "page-lines.json",
      "assets/data/translations/*.json",
    ]) {
      expect(script).toContain(requiredCopy);
    }
  });
});
