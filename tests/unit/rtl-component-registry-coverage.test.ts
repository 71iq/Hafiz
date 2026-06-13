import fs from "node:fs";
import path from "node:path";
import { rtlComponentRegistry } from "../rtl/rtl-component-registry";

const root = process.cwd();

function walkFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolute));
    } else if (/^[A-Z].*\.tsx$/.test(entry.name)) {
      files.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  }

  return files.sort();
}

describe("RTL component registry coverage", () => {
  const componentFiles = walkFiles(path.join(root, "components"));
  const registryPaths = rtlComponentRegistry.map((item) => item.path).sort();

  it("keeps every PascalCase component file classified", () => {
    expect(registryPaths).toEqual(componentFiles);
  });

  it("keeps registry paths unique and sorted by file path", () => {
    expect(new Set(registryPaths).size).toBe(registryPaths.length);
    expect(rtlComponentRegistry.map((item) => item.path)).toEqual(registryPaths);
  });

  it("keeps every registry entry actionable", () => {
    for (const item of rtlComponentRegistry) {
      expect(fs.existsSync(path.join(root, item.path))).toBe(true);
      expect(item.notes.trim().length).toBeGreaterThan(12);
      expect(item.path).toMatch(/^components\/.+\.tsx$/);
    }
  });
});

