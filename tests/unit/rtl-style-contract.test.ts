import fs from "node:fs";
import path from "node:path";
import { rtlStyleAllowlist, type RtlStyleAllowlistEntry } from "../rtl/rtl-style-allowlist";

const root = process.cwd();
const scannedRoots = ["components", "app", "lib/ui"];

const physicalDirectionPatterns = [
  /\bmarginLeft\b/,
  /\bmarginRight\b/,
  /\bpaddingLeft\b/,
  /\bpaddingRight\b/,
  /\bborderLeft\b/,
  /\bborderRight\b/,
  /\bleft\s*:/,
  /\bright\s*:/,
  /\btextAlign\s*:\s*["']left["']/,
  /\btextAlign\s*:\s*["']right["']/,
  /(^|[\s"'`])(?:ml|mr|pl|pr|left|right)-/,
  /(^|[\s"'`])(?:text-left|text-right|rounded-l|rounded-r|border-l|border-r|origin-left|origin-right)(?:\s|["'`}]|$)/,
];

function walkSourceFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(absolute));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(absolute);
    }
  }

  return files;
}

function patternMatches(pattern: RtlStyleAllowlistEntry["pattern"], line: string) {
  return typeof pattern === "string" ? line.includes(pattern) : pattern.test(line);
}

function isAllowlisted(relativePath: string, line: string) {
  return rtlStyleAllowlist.some((entry) => entry.file === relativePath && patternMatches(entry.pattern, line));
}

function isCommentOnly(line: string) {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

function isDirectionAwareContext(context: string) {
  return (
    /\bisRTL\b/.test(context) ||
    /\bdir\b/.test(context) ||
    /uiLanguage\s*===\s*["']ar["']/.test(context) ||
    /locale\s*===\s*["']ar["']/.test(context) ||
    /writingDirection\s*:\s*["']rtl["']/.test(context) ||
    /row-reverse/.test(context)
  );
}

function isFullWidthCenteredContext(context: string) {
  return (
    /(left|right)-0/.test(context) ||
    (/left\s*:\s*0/.test(context) && /right\s*:\s*0/.test(context))
  );
}

function hasPhysicalDirection(line: string) {
  return physicalDirectionPatterns.some((pattern) => pattern.test(line));
}

describe("static RTL style contract", () => {
  it("does not introduce unclassified physical left/right UI styles", () => {
    const violations: string[] = [];

    for (const scannedRoot of scannedRoots) {
      for (const file of walkSourceFiles(path.join(root, scannedRoot))) {
        const relativePath = path.relative(root, file).split(path.sep).join("/");
        const lines = fs.readFileSync(file, "utf8").split("\n");

        lines.forEach((line, index) => {
          if (!hasPhysicalDirection(line) || isCommentOnly(line)) return;

          const context = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3)).join("\n");
          if (isDirectionAwareContext(context)) return;
          if (isFullWidthCenteredContext(context)) return;
          if (isAllowlisted(relativePath, line)) return;

          violations.push(`${relativePath}:${index + 1} ${line.trim()}`);
        });
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps every RTL style allowlist entry documented and in use", () => {
    const sources = new Map<string, string[]>();
    for (const scannedRoot of scannedRoots) {
      for (const file of walkSourceFiles(path.join(root, scannedRoot))) {
        sources.set(path.relative(root, file).split(path.sep).join("/"), fs.readFileSync(file, "utf8").split("\n"));
      }
    }

    for (const entry of rtlStyleAllowlist) {
      const lines = sources.get(entry.file);
      if (!lines) {
        throw new Error(`${entry.file} should exist in scanned roots`);
      }
      expect(entry.reason.trim().length).toBeGreaterThan(20);
      if (!lines.some((line) => patternMatches(entry.pattern, line))) {
        throw new Error(`${entry.file} allowlist pattern should match current source: ${entry.pattern}`);
      }
    }
  });
});
