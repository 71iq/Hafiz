export type QiraatBlock = {
  heading: string | null;
  body: string;
};

export function parseQiraatText(raw: string): QiraatBlock[] {
  const text = raw.trim();
  if (!text) return [];
  const parts = text.split(/((?:و?قرئ)(?:\s*شاذا)?\s*:)/);
  const blocks: QiraatBlock[] = [];
  let i = 0;

  if (parts.length === 1) return [{ heading: null, body: formatQiraatBody(parts[0]) }];

  while (i < parts.length) {
    const headingRaw = (parts[i] ?? "").trim();
    const marker = (parts[i + 1] ?? "").trim();
    const body = (parts[i + 2] ?? "").trim();
    if (marker) {
      const heading = headingRaw.replace(/[:\.\s]+$/, "").trim() || null;
      blocks.push({ heading, body: formatQiraatBody(body) });
      i += 3;
    } else {
      if (blocks.length > 0 && headingRaw) {
        blocks[blocks.length - 1].body += "\n" + formatQiraatBody(headingRaw);
      } else if (headingRaw) {
        blocks.push({ heading: null, body: formatQiraatBody(headingRaw) });
      }
      i += 1;
    }
  }
  return blocks.filter((block) => block.body.trim().length > 0);
}

function formatQiraatBody(text: string): string {
  return text.replace(/([.])\s*([\d٠-٩]+\s*-)/g, "$1\n$2");
}
