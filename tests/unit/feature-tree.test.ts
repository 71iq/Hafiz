import fs from "node:fs";
import path from "node:path";

type FeatureNode = {
  id: string;
  title: string;
  kind: "root" | "group" | "screen" | "widget" | "transition";
  cases: string[];
  uses: string[];
  native: boolean;
  children: FeatureNode[];
};

const root = path.resolve(__dirname, "../..");
const tree = JSON.parse(fs.readFileSync(path.join(root, "docs/feature-tree.json"), "utf8")) as FeatureNode;
const userCases = fs.readFileSync(path.join(root, "user cases.md"), "utf8");

function flatten(node: FeatureNode): FeatureNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

const nodes = flatten(tree);
const ids = new Set(nodes.map((node) => node.id));

describe("feature tree (docs/feature-tree.json)", () => {
  it("gives every node a unique id, a title and a known kind", () => {
    expect(ids.size).toBe(nodes.length);
    for (const node of nodes) {
      expect(node.title.trim()).not.toBe("");
      expect(["root", "group", "screen", "widget", "transition"]).toContain(node.kind);
    }
  });

  it("points every uses entry at an existing node", () => {
    const dangling = nodes.flatMap((node) =>
      node.uses.filter((use) => !ids.has(use)).map((use) => `${node.id} -> ${use}`),
    );
    expect(dangling).toEqual([]);
  });

  it("assigns every user case to exactly one node", () => {
    const documented = [...userCases.matchAll(/^- ([A-Z]+-\d+)\./gm)].map((match) => match[1]);
    const owners = new Map<string, string[]>();
    for (const node of nodes) for (const id of node.cases) owners.set(id, [...(owners.get(id) ?? []), node.id]);

    expect(documented.filter((id) => !owners.has(id))).toEqual([]);
    expect([...owners.keys()].filter((id) => !documented.includes(id))).toEqual([]);
    expect([...owners].filter(([, owner]) => owner.length > 1)).toEqual([]);
  });
});
