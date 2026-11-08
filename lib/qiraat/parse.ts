export type QiraatBlock = {
  heading: string | null;
  body: string;
};

export function parseQiraatText(raw: string): QiraatBlock[] {
  const text = raw.trim();
  if (!text) return [];
  const parts = text.split(/((?:و?قرئ)(?:\s*شاذا)?\s*:)/);
  if (parts.length === 1) return [{ heading: null, body: formatQiraatBody(parts[0]) }];

  const heading = parts[0].replace(/[:\.\s]+$/, "").trim() || null;
  const blocks: QiraatBlock[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const body = (parts[i + 1] ?? "").trim();
    if (body) blocks.push({ heading: blocks.length === 0 ? heading : null, body: formatQiraatBody(body) });
  }
  return blocks;
}

function formatQiraatBody(text: string): string {
  return text.replace(/([.])\s*([\d٠-٩]+\s*-)/g, "$1\n$2");
}
