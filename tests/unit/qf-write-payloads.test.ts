import {
  readQfBookmarkAcknowledgement,
  readQfNoteAcknowledgement,
  requireQfDeleteAcknowledgement,
} from "@/lib/quran-foundation/user-payloads";

const OLD = "2000-01-01T00:00:00.000Z";
const bookmark = {
  id: "opaque bookmark",
  type: "ayah",
  surah: 2,
  ayah: 255,
  createdAt: OLD,
  isInDefaultCollection: false,
  collectionsCount: 0,
};
const note = { id: "opaque note", body: "synthetic note", ranges: ["2:255-2:255"], createdAt: OLD, updatedAt: OLD };

it("retains valid bookmark metadata and opaque identifiers", () => {
  expect(readQfBookmarkAcknowledgement({ ok: true, bookmark }, { surah: 2, ayah: 255 })).toEqual(bookmark);
});
it.each([
  { field: "id", value: " " },
  { field: "type", value: "page" },
  { field: "surah", value: "2" },
  { field: "surah", value: 3 },
  { field: "ayah", value: 256 },
  { field: "createdAt", value: null },
  { field: "isInDefaultCollection", value: "false" },
  { field: "collectionsCount", value: -1 },
  { field: "collectionsCount", value: 0.5 },
  { field: "collectionsCount", value: Infinity },
])("rejects malformed bookmark $field=$value", ({ field, value }) => {
  expect(() =>
    readQfBookmarkAcknowledgement({ ok: true, bookmark: { ...bookmark, [field]: value } }, bookmark),
  ).toThrow("Incomplete Quran Foundation bookmark");
});
it.each([null, [], {}, { ok: true, status: "connected" }, { ok: true, bookmark: null }, { ok: false, bookmark }])(
  "rejects a wrong bookmark envelope %j",
  (value) => {
    expect(() => readQfBookmarkAcknowledgement(value, bookmark)).toThrow("Incomplete Quran Foundation bookmark");
  },
);
it("keeps short nonblank note text, empty fallback ranges and opaque identifiers", () => {
  expect(readQfNoteAcknowledgement({ ok: true, note: { ...note, body: "x", ranges: [] } }, note.id)).toEqual({
    ...note,
    body: "x",
    ranges: [],
  });
});
it.each([
  { field: "id", value: "" },
  { field: "body", value: " " },
  { field: "body", value: 1 },
  { field: "createdAt", value: "" },
  { field: "updatedAt", value: null },
  { field: "ranges", value: null },
  { field: "ranges", value: ["2:255-2:255", 7] },
  { field: "ranges", value: new Array(1) },
])("rejects malformed note $field=$value", ({ field, value }) => {
  expect(() => readQfNoteAcknowledgement({ ok: true, note: { ...note, [field]: value } })).toThrow(
    "Incomplete Quran Foundation note",
  );
});
it("rejects a note acknowledgement for a different update target", () => {
  expect(() => readQfNoteAcknowledgement({ ok: true, note }, "different note")).toThrow(
    "Incomplete Quran Foundation note",
  );
});
it.each([null, [], {}, { ok: true, status: "connected" }, { ok: true, note: null }, { ok: false, note }])(
  "rejects a wrong note envelope %j",
  (value) => {
    expect(() => readQfNoteAcknowledgement(value)).toThrow("Incomplete Quran Foundation note");
  },
);
it("accepts the explicit successful delete acknowledgement", () => {
  expect(() => requireQfDeleteAcknowledgement({ ok: true, deleted: true })).not.toThrow();
});
it.each([
  null,
  [],
  {},
  { ok: true },
  { ok: true, deleted: false },
  { ok: true, deleted: 1 },
  { ok: false, deleted: true },
  { ok: true, status: "connected" },
])("rejects an unconfirmed delete %j", (value) => {
  expect(() => requireQfDeleteAcknowledgement(value)).toThrow("Incomplete Quran Foundation delete");
});
