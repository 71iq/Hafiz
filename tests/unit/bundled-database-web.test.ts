const mockImport = jest.fn<Promise<void>, [string, { assetId: number; forceOverwrite?: boolean }]>();
const mockOpen = jest.fn();

jest.mock("expo-sqlite", () => ({
  importDatabaseFromAssetAsync: (...args: [string, { assetId: number; forceOverwrite?: boolean }]) =>
    mockImport(...args),
  openDatabaseAsync: (...args: unknown[]) => mockOpen(...args),
}));

// Jest resolves the native module by default; this exercises the web implementation.
const { openBundledDatabase } = jest.requireActual<typeof import("@/lib/database/bundled-database")>(
  "../../lib/database/bundled-database.ts",
);

function databaseWithAyahs(count: number | Error) {
  return {
    getFirstAsync: jest.fn(async () => {
      if (count instanceof Error) throw count;
      return { count };
    }),
    closeAsync: jest.fn(async () => undefined),
  };
}

describe("web bundled Quran database", () => {
  beforeEach(() => {
    mockImport.mockReset().mockResolvedValue(undefined);
    mockOpen.mockReset();
  });

  it("opens a complete stored database once and hands back that connection", async () => {
    const database = databaseWithAyahs(6236);
    mockOpen.mockResolvedValue(database);

    await expect(openBundledDatabase("hafiz.db", () => true, 7)).resolves.toBe(database);

    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledWith("hafiz.db", { useNewConnection: true });
    expect(mockImport).not.toHaveBeenCalled();
    expect(database.closeAsync).not.toHaveBeenCalled();
  });

  it.each([
    ["the empty file a first visit creates", new Error("no such table: quran_text")],
    ["a database left partial by an interrupted first visit", 1200],
    ["a stored file that cannot be read as a database", new Error("file is not a database")],
  ])("replaces %s and opens the copy", async (_name, stored) => {
    const first = databaseWithAyahs(stored);
    const copied = databaseWithAyahs(6236);
    const order: string[] = [];
    mockOpen.mockResolvedValueOnce(first).mockResolvedValueOnce(copied);
    first.closeAsync.mockImplementation(async () => void order.push("close"));
    mockImport.mockImplementation(async () => void order.push("import"));

    await expect(openBundledDatabase("hafiz.db", () => true, 7)).resolves.toBe(copied);

    // The stored file is closed before it is replaced: the copy refuses an open database.
    expect(order).toEqual(["close", "import"]);
    expect(mockImport).toHaveBeenCalledWith("hafiz.db", { assetId: 7, forceOverwrite: true });
    expect(mockOpen).toHaveBeenCalledTimes(2);
  });

  it("does not open the copy for a start-up that was abandoned while it downloaded", async () => {
    mockOpen.mockResolvedValue(databaseWithAyahs(0));

    await expect(openBundledDatabase("hafiz.db", () => false, 7)).resolves.toBeNull();

    expect(mockImport).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it("reports a failed copy instead of opening an unusable database", async () => {
    mockOpen.mockResolvedValue(databaseWithAyahs(0));
    mockImport.mockRejectedValue(new Error("The asset is not a complete SQLite database"));

    await expect(openBundledDatabase("hafiz.db", () => true, 7)).rejects.toThrow("not a complete SQLite database");

    expect(mockOpen).toHaveBeenCalledTimes(1);
  });
});
