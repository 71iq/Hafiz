import { arrowKeysBelongToTarget, detailArrowStep } from "@/components/mushaf/use-detail-arrow-keys";
import { formatOccurrences } from "@/lib/i18n/count";
import { ensureTafsirSourceImported } from "@/lib/database/init";
import { importTafsirSource, isTafsirSourceImporting } from "@/lib/tafsir/import";

jest.mock("@/lib/database/init", () => ({ ensureTafsirSourceImported: jest.fn() }));

function element(tagName: string, attributes: Record<string, string> = {}, parentElement: object | null = null) {
  return {
    tagName,
    isContentEditable: attributes.contenteditable === "true",
    getAttribute: (name: string) => attributes[name] ?? null,
    parentElement,
  };
}

describe("detail sheet arrow keys", () => {
  it("mirrors Left and Right in Arabic", () => {
    expect(detailArrowStep("ArrowLeft", false)).toBe("previous");
    expect(detailArrowStep("ArrowRight", false)).toBe("next");
    expect(detailArrowStep("ArrowLeft", true)).toBe("next");
    expect(detailArrowStep("ArrowRight", true)).toBe("previous");
    expect(detailArrowStep("ArrowUp", false)).toBeNull();
  });

  it("leaves arrows to text fields and controls that use them", () => {
    expect(arrowKeysBelongToTarget(element("TEXTAREA"))).toBe(true);
    expect(arrowKeysBelongToTarget(element("INPUT"))).toBe(true);
    expect(arrowKeysBelongToTarget(element("DIV", { contenteditable: "true" }))).toBe(true);
    expect(arrowKeysBelongToTarget(element("DIV", { role: "slider" }))).toBe(true);
    expect(arrowKeysBelongToTarget(element("SPAN", {}, element("DIV", { role: "tab" })))).toBe(true);
    expect(arrowKeysBelongToTarget(element("DIV", { role: "button" }))).toBe(false);
    expect(arrowKeysBelongToTarget(null)).toBe(false);
  });
});

describe("occurrence counts", () => {
  it("uses Arabic counted forms and English plurals", () => {
    expect(formatOccurrences(1, "ar")).toBe("موضع واحد");
    expect(formatOccurrences(2, "ar")).toBe("موضعان");
    expect(formatOccurrences(7, "ar")).toBe("٧ مواضع");
    expect(formatOccurrences(25, "ar")).toBe("٢٥ موضعًا");
    expect(formatOccurrences(100, "ar")).toBe("١٠٠ موضع");
    expect(formatOccurrences(1, "en")).toBe("1 occurrence");
    expect(formatOccurrences(1200, "en")).toBe("1,200 occurrences");
  });
});

describe("tafsir import owner", () => {
  const db = { synthetic: true } as unknown as Parameters<typeof importTafsirSource>[0];

  function deferred() {
    let resolve: () => void = () => undefined;
    let reject: (error: Error) => void = () => undefined;
    const promise = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    return { promise, resolve, reject };
  }

  beforeEach(() => jest.mocked(ensureTafsirSourceImported).mockReset());

  it("shares one running import per source and clears it when it settles", async () => {
    const first = deferred();
    jest.mocked(ensureTafsirSourceImported).mockReturnValueOnce(first.promise);
    const a = importTafsirSource(db, "razi");
    const b = importTafsirSource(db, "razi");
    expect(b).toBe(a);
    expect(isTafsirSourceImporting("razi")).toBe(true);
    expect(ensureTafsirSourceImported).toHaveBeenCalledTimes(1);
    first.resolve();
    await a;
    expect(isTafsirSourceImporting("razi")).toBe(false);
  });

  it("runs imports of different sources one after another", async () => {
    const first = deferred();
    const second = deferred();
    jest.mocked(ensureTafsirSourceImported).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a = importTafsirSource(db, "razi");
    const b = importTafsirSource(db, "alusi");
    await Promise.resolve();
    expect(ensureTafsirSourceImported).toHaveBeenCalledTimes(1);
    first.reject(new Error("synthetic failure"));
    await expect(a).rejects.toThrow("synthetic failure");
    await Promise.resolve();
    expect(ensureTafsirSourceImported).toHaveBeenCalledTimes(2);
    expect(ensureTafsirSourceImported).toHaveBeenLastCalledWith(db, "alusi");
    second.resolve();
    await b;
  });
});
