# Tafsir replacement atomicity investigation

RF-098, 2026-10-27. This investigation reproduces incomplete-source replacement failures. It does not repair the importer or establish that a production user has encountered them. RF-104 owns the repair and blocks final mission acceptance.

## Actual behavior

`ensureTafsirSourceImported` in `lib/database/init.ts` counts the requested source and returns when its configured expected count is met. For an incomplete source it deletes that source, then loads and inserts 114 surah files. `batchInsert` commits each batch separately. The initial deletion has no transaction covering the whole replacement.

| Synthetic case                                  | Observed result                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Qurtubi has 6234 rows                           | Returns without loading or writing.                                                                        |
| Al-Bahr al-Madid has 5843 rows                  | Returns without loading or writing.                                                                        |
| A default-count source has 6236 rows            | Returns without loading or writing.                                                                        |
| Partial source, first loader rejects            | Rejects after deleting the existing rows. Other-source rows remain.                                        |
| Partial source, second loader rejects           | Rejects with the first replacement prefix already committed.                                               |
| SQL execution fails during a replacement batch  | Rolls back that batch but cannot restore the earlier deletion.                                             |
| All 114 loaders return no content               | Throws unavailable after deleting prior partial content.                                                   |
| Initially empty source, unavailable replacement | Rejects and leaves other-source content intact.                                                            |
| Retry after a load rejection                    | Can install new synthetic rows. A partial synthetic success remains below the real completeness threshold. |
| Two callers overlap during loading              | Both delete before loading. Their successful writes can leave rows from different replacement generations. |

The concurrency case deliberately completes one caller's SQL before releasing the other's loader. It demonstrates mixed generations without relying on a nested-transaction error or timing lottery. The SQL-failure case uses real SQLite rollback of the current batch. The tests retain full SQL traces and exact before/after rows.

## Reproduction and boundaries

Evidence lives at `.refactor-baseline/rf098-atomic-import-investigation-v1/`. Run `node .refactor-baseline/rf098-atomic-import-investigation-v1/reproduce.cjs` from the modernization worktree. It executes ten assertions against actual whole TypeScript modules transpiled with the installed compiler. It does not slice or copy the importer. Its injected boundaries select the native-loader branch and supply synthetic loader results. Node's in-memory SQLite executes the real SQL with a small asynchronous adapter.

This is a model of the importer and SQL contract. It is not an Expo Android/iOS runtime test, a browser/OPFS bridge test or a physical-device test. The row identifiers and text are synthetic. No protected asset, bundled Quran database, network service or live database is loaded. No production corruption, native locking behavior or cross-tab isolation claim follows from these fixtures.

The checked-in web database proxy sends BEGIN, individual operations and COMMIT as separate requests. The existing batch importer also opens transactions. Wrapping the current importer in another ordinary transaction would therefore require nested-transaction and request-interleaving decisions. The installed native and web contracts need separate verification before selecting a repair.

## Required repair invariant

A failed replacement must leave the previously stored source unchanged. A successful replacement must expose one internally consistent candidate generation, and unrelated sources must remain unchanged. Concurrent callers must not interleave replacement generations. Keep the configured completeness thresholds, count fast paths, identifiers, content parsing and existing retry behavior unless a separately reviewed decision changes them.

RF-104 must first choose the transaction owner for native SQLite and the web host/proxy. Inspect existing serialization rather than assuming an ordinary asynchronous transaction is exclusive. Stage replacement loading and validation before destructive writes, then replace through a tested atomic write operation without nesting the current batch transactions. Decide partial/unavailable-candidate semantics explicitly without lowering thresholds. Reproduce rollback, later-file failure, SQL failure, retry, same/different-source concurrent callers and interleaved web requests. Use the current fixture evidence as the failing baseline, then add permanent behavior tests with the retained-content invariant.

No importer, schema, provider, source registry, dependency, protected input or production setting changes in RF-098. Fresh reproduction, artifact/inventory integrity, document formatting and whitespace checks plus separate stronger review are required before accepting this investigation. Application typecheck, full Jest, builds, browser/native/device checks are not claimed for this documentation-only investigation.
