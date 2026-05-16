const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

async function main() {
  const root = path.resolve(__dirname, "..");
  const datasetPath = path.join(root, "assets/data/reflection-journey.json");
  const quranDataPath = path.join(root, "assets/data/quran-data.json");
  const schemaPath = path.join(root, "lib/reflection-journey/schema.ts");

  const { buildAyahCountIndex, loadAndValidateReflectionJourneySeed } = await import(
    pathToFileURL(schemaPath).href
  );

  const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));
  const quranData = JSON.parse(fs.readFileSync(quranDataPath, "utf8"));
  const ayahCountIndex = buildAyahCountIndex(quranData);
  const parsed = loadAndValidateReflectionJourneySeed(dataset, ayahCountIndex);

  console.log(
    `[ReflectionJourney] Validated schemaVersion=${parsed.schemaVersion} with ${parsed.levels.length} level(s).`
  );
}

main().catch((error) => {
  console.error("[ReflectionJourney] Validation failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
