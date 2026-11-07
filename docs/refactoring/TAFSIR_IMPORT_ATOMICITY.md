# Tafsir replacement atomicity

An incomplete downloadable tafsir source is replaced as one transaction. The importer stages all 114 source files and validates the configured distinct-coordinate count before requesting the database owner. The scoped transaction deletes only that source, inserts the complete candidate through one prepared command, finalizes it and commits. Other importers retain their existing batches of 500 rows.

A known INSERT or COMMIT failure rolls back the complete replacement and preserves the previous source, unrelated sources, settings and pending sync work. Loading, HTTP, JSON, empty or incomplete-candidate failures do not start a replacement. A fresh invocation can retry. Existing count shortcuts, thresholds for each source, text cleaning and last-duplicate-wins behavior are unchanged.

Concurrent replacements use RF161's private connection owner on native and the versioned browser bridge. Each replacement reserves the whole transaction. The last admitted same-source replacement wins as one complete generation; a queued ordinary operation observes the settled generation. Staging can run concurrently and does not hold the database reservation.

## Verification

Permanent synthetic tests are in `tests/unit/tafsir-import-safety.test.ts`. They execute the importer against actual isolated Node SQLite through the real connection owner. SQLite triggers reject first/later inserts, and a deferred foreign-key constraint rejects COMMIT. Tests compare retained rows and metadata, retry successfully, overlap same/different-source candidates and interleave another bridge client's ordinary write. Existing RF155 download, parsing and completeness cases remain.

`tests/e2e/tafsir-import.spec.ts` exercises the actual local Chrome Settings picker, installed SQLite worker/WASM/OPFS, 114 synthetic download responses and a real SQLite trigger. It checks visible commit-failure recovery, retained content/selection and successful retry. A separate insert-failure case verifies retained data and retry across conservative provider recovery; RF163 owns the disappearing notification in that path. Only fresh preview data is written. Controller results and independent acceptance are recorded briefly in PROGRESS.

An acknowledgement lost after SQLite has actually committed has an unknown outcome. The owner quarantines the handle and does not replay the replacement. Tests demonstrate a complete committed generation under simulated acknowledgement loss, without promising that every rejected call restored old rows. Node's automatic statement lifecycle and JavaScript exports do not prove native SDK or device behavior; RF041 retains that verification.

RF098 reproduced the original deletion/per-batch exposure. RF155 added complete download staging. RF161 established transaction ownership, and RF104 makes this replacement atomic. The historical reproduction is removed after acceptance because permanent regressions cover the current implementation.
