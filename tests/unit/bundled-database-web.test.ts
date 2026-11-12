const mockImport = jest.fn<Promise<void>, [string, { assetId: number; forceOverwrite?: boolean }]>();
const mockOpen = jest.fn();

jest.mock("expo-sqlite", () => ({
  importDatabaseFromAssetAsync: (...args: [string, { assetId: number; forceOverwrite?: boolean }]) => mockImport(...args),
  openDatabaseAsync: (...args: unknown[]) => mockOpen(...args),
}));

// Jest resolves the native module by default; this exercises the web implementation.
const { importBundledDatabase } = jest.requireActual<typeof import("@/lib/database/bundled-database")>(
  "../../lib/database/bundled-database.ts",
);

function databaseWithAyahs(count: number) {
  return { getFirstAsync: jest.fn(async () => ({ count })), closeAsync: jest.fn(async () => undefined) };
}

describe("web bundled Quran database", () => {
  beforeEach(() => {
    mockImport.mockReset().mockResolvedValue(undefined);
    mockOpen.mockReset();
  });

  it("keeps a complete stored database without copying it again", async () => {
    const database = databaseWithAyahs(6236);
    mockOpen.mockResolvedValue(database);

    await importBundledDatabase("hafiz.db", 7);

    expect(mockImport).toHaveBeenCalledTimes(1);
    expect(mockImport).toHaveBeenCalledWith("hafiz.db", { assetId: 7 });
    expect(database.closeAsync).toHaveBeenCalled();
  });

  it("copies again over a database left partial by an interrupted first visit", async () => {
    mockOpen.mockResolvedValue(databaseWithAyahs(1200));

    await importBundledDatabase("hafiz.db", 7);

    expect(mockImport).toHaveBeenLastCalledWith("hafiz.db", { assetId: 7, forceOverwrite: true });
  });

  it("copies again when the stored file cannot be read as a database", async () => {
    mockOpen.mockRejectedValue(new Error("file is not a database"));

    await importBundledDatabase("hafiz.db", 7);

    expect(mockImport).toHaveBeenLastCalledWith("hafiz.db", { assetId: 7, forceOverwrite: true });
  });
});
