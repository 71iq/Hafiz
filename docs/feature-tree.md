# Feature tree

`docs/feature-tree.json` maps every screen, widget, transition and shared flow in Hafiz to the user cases in `user cases.md`. Shared behavior appears once: a node that relies on another node lists it under `uses` rather than repeating its cases. This makes the tree a checklist for audits, test planning and impact analysis, where each node is checked once.

## Node fields

- `id`: a stable dotted path, such as `reader.audio.range`. Other nodes and tools refer to it, so rename it only when its meaning changes.
- `title`: what the node covers, in a few words.
- `kind`: one of `root`, `group`, `screen`, `widget` or `transition`.
- `cases`: the user case IDs, such as `READ-04`, that this node owns. Each case in `user cases.md` belongs to exactly one node.
- `uses`: the IDs of other nodes whose behavior this node relies on.
- `native`: `true` when the node can only be checked on a native device, for example background audio.
- `children`: nested nodes.

## Keep it current

Update the tree in the same change whenever a screen, widget, transition or shared flow is added, removed, renamed, merged or split, or a user case moves:

- Add a node for new UI or a new flow, under the group where a user meets it, with its cases and `uses`.
- Remove the node, its cases and any `uses` that point to it when a component or flow goes away.
- Move cases when behavior moves from one component to another.

`tests/unit/feature-tree.test.ts` checks that IDs are unique, that every `uses` entry points to a real node, and that every case in `user cases.md` belongs to exactly one node.
