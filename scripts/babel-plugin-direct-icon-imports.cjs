// Rewrites `import { BookOpen } from "lucide-react-native"` to import the icon's own module.
//
// The package entry re-exports all 1,700 icons, and Metro has no tree shaking, so a single named
// import bundles and evaluates every one of them: 1.2 MB of a 7 MB web script for the hundred or so
// icons the app uses. Source files keep the plain named import, which is what TypeScript, ESLint and
// the Jest mocks of this package read.

const fs = require("node:fs");
const path = require("node:path");

const PACKAGE = "lucide-react-native";
const REEXPORT = /^export \{([^}]+)\} from '(\.\/[^']+)';$/;

/** Each exported name mapped to the file whose default export it is. */
function readEntry() {
  // The package's export map hides package.json, so start from its CommonJS entry in dist/cjs.
  const entry = path.join(path.dirname(require.resolve(PACKAGE)), "../esm/lucide-react-native.js");
  const files = new Map();
  for (const line of fs.readFileSync(entry, "utf8").split("\n")) {
    const match = REEXPORT.exec(line.trim());
    if (!match) continue;
    for (const part of match[1].split(",")) {
      const name = /^default as (\w+)$/.exec(part.trim());
      if (name) files.set(name[1], path.join(path.dirname(entry), match[2]));
    }
  }
  if (files.size === 0) throw new Error(`No icon was found in ${entry}`);
  return files;
}

module.exports = function directIconImports({ types: t }) {
  const files = readEntry();
  return {
    name: "direct-icon-imports",
    visitor: {
      ImportDeclaration(declaration) {
        const { node } = declaration;
        if (node.source.value !== PACKAGE || node.importKind === "type") return;
        const direct = [];
        const other = [];
        for (const specifier of node.specifiers) {
          const name =
            t.isImportSpecifier(specifier) && specifier.importKind !== "type"
              ? (specifier.imported.name ?? specifier.imported.value)
              : null;
          const file = name ? files.get(name) : undefined;
          if (file) {
            direct.push(t.importDeclaration([t.importDefaultSpecifier(specifier.local)], t.stringLiteral(file)));
          } else {
            other.push(specifier);
          }
        }
        if (direct.length === 0) return;
        // Types and anything the entry does not re-export stay on the package import.
        if (other.length > 0) direct.push(t.importDeclaration(other, t.stringLiteral(PACKAGE)));
        declaration.replaceWithMultiple(direct);
      },
    },
  };
};
