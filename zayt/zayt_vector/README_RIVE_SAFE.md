# Zayt Rive-safe SVG kit

This variant removes the SVG features most likely to break or stall Rive import:

- no filters
- no masks
- no clip paths
- no embedded images
- no CSS classes or style block
- no gradients
- no defs block
- no external references

Tradeoff: it is flatter than the richer v3 artwork, but it should import cleanly and can be recolored/rebuilt with Rive fills.

All SVGs share the same 512x512 viewBox and can be stacked directly.
