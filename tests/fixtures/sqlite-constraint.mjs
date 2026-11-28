import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import loadWasm from "../../node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.js";
import { Factory, SQLITE_CONSTRAINT, SQLITE_DONE, SQLITE_OK } from "../../node_modules/expo-sqlite/web/wa-sqlite/sqlite-api.js";
import { MemoryVFS } from "../../node_modules/expo-sqlite/web/wa-sqlite/MemoryVFS.js";

const wasmBinary = readFileSync(new URL("../../node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.wasm", import.meta.url));
const module = await loadWasm({ wasmBinary });
const sqlite = Factory(module);
const vfs = await MemoryVFS.create("fixture", module);
sqlite.vfs_register(vfs, true);
const db = await sqlite.open_v2("fixture.sqlite");
try {
  await sqlite.exec(db, `CREATE TABLE notes(content TEXT);
    CREATE TRIGGER reject_note BEFORE INSERT ON notes WHEN NEW.content = 'draft'
    BEGIN SELECT RAISE(ABORT, 'fixture rejected note'); END`);
  for (const reject of [true, false]) {
    await sqlite.exec(db, "BEGIN");
    for await (const stmt of sqlite.statements(db, "INSERT INTO notes VALUES ('draft')", { unscoped: true })) {
      if (reject) {
        await assert.rejects(sqlite.step(stmt), { code: SQLITE_CONSTRAINT, message: /fixture rejected note/ });
      } else {
        assert.equal(await sqlite.step(stmt), SQLITE_DONE);
      }
      assert.equal(await sqlite.finalize(stmt), SQLITE_OK);
    }
    await sqlite.exec(db, reject ? "ROLLBACK; DROP TRIGGER reject_note" : "COMMIT");
  }
  const rows = [];
  await sqlite.exec(db, "SELECT content FROM notes", (row) => rows.push(row));
  assert.deepEqual(rows, [["draft"]]);
} finally {
  await sqlite.close(db);
  vfs.close();
}
