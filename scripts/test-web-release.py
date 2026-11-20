#!/usr/bin/env python3
"""Unit tests for the static release archive validator."""

import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / "deploy/hetzner/promote.py"
SPEC = importlib.util.spec_from_file_location("hafiz_promote", MODULE_PATH)
assert SPEC and SPEC.loader
promote = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(promote)


COMMIT = "a" * 40


def tar_bytes(entries):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w") as archive:
        for entry in entries:
            name = entry[0]
            kind = entry[1] if len(entry) > 1 else "file"
            value = entry[2] if len(entry) > 2 else b""
            info = tarfile.TarInfo(name)
            if kind == "dir":
                info.type = tarfile.DIRTYPE
                info.mode = 0o755
            elif kind == "symlink":
                info.type = tarfile.SYMTYPE
                info.linkname = value
            elif kind == "hardlink":
                info.type = tarfile.LNKTYPE
                info.linkname = value
            else:
                if isinstance(value, str):
                    value = value.encode()
                info.size = len(value)
                archive.addfile(info, io.BytesIO(value))
                continue
            archive.addfile(info)
    return output.getvalue()


def valid_entries(commit=COMMIT):
    release = json.dumps({"commit": commit}).encode()
    return [
        ("dist", "dir"),
        ("dist/index.html", "file", b"<html>ok</html>"),
        ("dist/__release.json", "file", release),
        ("dist/NOTICE.md", "file", b"Notice\n"),
        ("SHA256SUMS", "file", b"placeholder\n"),
    ]


class ArchiveMemberTests(unittest.TestCase):
    def assert_invalid(self, entries):
        with tarfile.open(fileobj=io.BytesIO(tar_bytes(entries)), mode="r:") as archive:
            with self.assertRaises(ValueError):
                promote.checked_members(archive)

    def test_accepts_static_archive(self):
        entries = valid_entries()
        manifest = []
        for entry in entries:
            name = entry[0]
            kind = entry[1] if len(entry) > 1 else "file"
            value = entry[2] if len(entry) > 2 else b""
            if kind == "file" and name.startswith("dist/"):
                manifest.append(f"{hashlib.sha256(value).hexdigest()}  {name}")
        entries[-1] = ("SHA256SUMS", "file", ("\n".join(manifest) + "\n").encode())
        with tarfile.open(fileobj=io.BytesIO(tar_bytes(entries)), mode="r:") as archive:
            self.assertEqual(len(promote.checked_members(archive)), len(entries))

    def test_rejects_traversal_and_absolute_paths(self):
        self.assert_invalid(valid_entries()[:1] + [("dist/../escape", "file", b"x")] + valid_entries()[1:])
        self.assert_invalid(valid_entries()[:1] + [("/tmp/escape", "file", b"x")] + valid_entries()[1:])

    def test_accepts_expo_route_manifest(self):
        entries = valid_entries() + [("dist/_expo/.routes.json", "file", b"{}")]
        with tarfile.open(fileobj=io.BytesIO(tar_bytes(entries)), mode="r:") as archive:
            self.assertEqual(len(promote.checked_members(archive)), len(entries))

    def test_rejects_hidden_credentials_and_directories(self):
        self.assert_invalid(valid_entries() + [("dist/.env", "file", b"secret")])
        self.assert_invalid(valid_entries() + [("dist/.private/key", "file", b"secret")])

    def test_rejects_symbolic_and_hard_links(self):
        self.assert_invalid(valid_entries()[:1] + [("dist/link", "symlink", "index.html")] + valid_entries()[1:])
        self.assert_invalid(valid_entries()[:1] + [("dist/link", "hardlink", "dist/index.html")] + valid_entries()[1:])

    def test_rejects_duplicate_entries(self):
        self.assert_invalid(valid_entries() + [("dist/index.html", "file", b"again")])

    def test_rejects_missing_required_entry(self):
        self.assert_invalid([entry for entry in valid_entries() if entry[0] != "dist/NOTICE.md"])

    def test_rejects_expanded_member_size_bound(self):
        original = promote.MAX_EXPANDED
        promote.MAX_EXPANDED = 10
        try:
            self.assert_invalid(valid_entries())
        finally:
            promote.MAX_EXPANDED = original


class ExpansionAndManifestTests(unittest.TestCase):
    def test_rejects_expanded_gzip_size_bound(self):
        original = promote.MAX_EXPANDED
        promote.MAX_EXPANDED = 10
        try:
            compressed_bytes = io.BytesIO()
            with gzip.GzipFile(fileobj=compressed_bytes, mode="wb") as compressed:
                compressed.write(b"0123456789abcdef")
            compressed_bytes.seek(0)
            with self.assertRaises(ValueError):
                promote.expand_archive(compressed_bytes, io.BytesIO())
        finally:
            promote.MAX_EXPANDED = original

    def make_runtime(self, manifest, commit=COMMIT):
        root = Path(tempfile.mkdtemp())
        (root / "dist").mkdir()
        (root / "dist/index.html").write_bytes(b"<html>ok</html>")
        (root / "dist/NOTICE.md").write_bytes(b"Notice\n")
        (root / "dist/__release.json").write_text(json.dumps({"commit": commit}))
        (root / "SHA256SUMS").write_text(manifest)
        return root

    def valid_manifest(self):
        files = ["dist/__release.json", "dist/NOTICE.md", "dist/index.html"]
        return "".join(
            f"{hashlib.sha256((self.runtime / name).read_bytes()).hexdigest()}  {name}\n"
            for name in files
        )

    def setUp(self):
        self.runtime = self.make_runtime("")

    def tearDown(self):
        import shutil

        shutil.rmtree(self.runtime)

    def test_accepts_complete_matching_manifest_and_commit(self):
        (self.runtime / "SHA256SUMS").write_text(self.valid_manifest())
        promote.verify_runtime(self.runtime, COMMIT)

    def test_rejects_invalid_manifest(self):
        for manifest in ("bad\n", "0" * 64 + " dist/index.html\n"):
            (self.runtime / "SHA256SUMS").write_text(manifest)
            with self.assertRaises(ValueError):
                promote.verify_runtime(self.runtime, COMMIT)

    def test_rejects_incomplete_manifest(self):
        self.runtime.joinpath("SHA256SUMS").write_text(
            f"{hashlib.sha256((self.runtime / 'dist/index.html').read_bytes()).hexdigest()}  dist/index.html\n"
        )
        with self.assertRaises(ValueError):
            promote.verify_runtime(self.runtime, COMMIT)

    def test_rejects_checksum_mismatch(self):
        manifest = self.valid_manifest()
        (self.runtime / "dist/index.html").write_bytes(b"changed")
        (self.runtime / "SHA256SUMS").write_text(manifest)
        with self.assertRaises(ValueError):
            promote.verify_runtime(self.runtime, COMMIT)

    def test_rejects_commit_mismatch(self):
        (self.runtime / "SHA256SUMS").write_text(self.valid_manifest())
        with self.assertRaises(ValueError):
            promote.verify_runtime(self.runtime, "b" * 40)


def blob_id(data):
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


class MigrationTests(unittest.TestCase):
    """apply_migrations with GitHub and the database replaced by recorders."""

    FILES = {
        "006_qf_oauth_states.sql": b"create table s (id int);\n",
        "006_reflection_feed_filters.sql": b"create index r on s (id);\n",
        "20261113120000_learning_consistency.sql": b"create table a (id int);\n",
        "20261201090000_add_b.sql": b"create function f() returns int language plpgsql as $$\nBEGIN\n  RETURN 1;\nEND;\n$$;\n",
        "20261130080000_add_c.sql": b"alter table a add column c text;\n",
    }

    def setUp(self):
        self.files = dict(self.FILES)
        self.merge_base, self.ahead_by = COMMIT, 0
        self.listing_extra = [{"type": "file", "name": "README.md", "sha": "c" * 40}]
        self.applied = {"006_qf_oauth_states.sql", "20261113120000_learning_consistency.sql"}
        self.scripts, self.dumps = [], []
        self.saved = {name: getattr(promote, name) for name in ("fetch", "psql", "dump_database")}
        promote.fetch = self.fake_fetch
        promote.psql = self.fake_psql
        promote.dump_database = lambda version: self.dumps.append(version) or Path("/dump")
        self.listed = None

    def tearDown(self):
        for name, value in self.saved.items():
            setattr(promote, name, value)

    def fake_fetch(self, url, limit):
        if url == f"{promote.GITHUB_API}/compare/main...{COMMIT}":
            return json.dumps({"merge_base_commit": {"sha": self.merge_base}, "ahead_by": self.ahead_by}).encode()
        if url == f"{promote.GITHUB_API}/contents/{promote.MIGRATIONS}?ref={COMMIT}":
            listed = self.listed or {name: blob_id(data) for name, data in self.files.items()}
            items = [{"type": "file", "name": name, "sha": blob} for name, blob in listed.items()]
            return json.dumps(items + self.listing_extra).encode()
        prefix = f"{promote.GITHUB_RAW}/{COMMIT}/{promote.MIGRATIONS}/"
        if url.startswith(prefix):
            return self.files[url[len(prefix):]]
        raise AssertionError("unexpected fetch " + url)

    def fake_psql(self, script, label, *options):
        if label == "history":
            return "\n".join(sorted(self.applied)) + "\n"
        if label == getattr(self, "fail_at", None):
            raise RuntimeError("Database step failed")
        self.scripts.append((label, script))
        return ""

    def test_applies_unrecorded_files_in_name_order_after_one_dump(self):
        expected = ["006_reflection_feed_filters.sql", "20261130080000_add_c.sql", "20261201090000_add_b.sql"]
        self.assertEqual(promote.apply_migrations(COMMIT), expected)
        self.assertEqual(self.dumps, [expected[0]])
        self.assertEqual([label for label, _ in self.scripts], [name[:-4] for name in expected])
        _, script = self.scripts[1]
        self.assertTrue(script.startswith("BEGIN;\nSET LOCAL lock_timeout = '10s';\n"))
        self.assertIn("alter table a add column c text;\n", script)
        blob = blob_id(self.files["20261130080000_add_c.sql"])
        self.assertIn(f"INSERT INTO hafiz_deploy.migrations (file, git_blob) VALUES ('20261130080000_add_c.sql', '{blob}');", script)
        self.assertTrue(script.endswith("NOTIFY pgrst, 'reload schema';\nCOMMIT;\n"))

    def test_nothing_pending_changes_nothing(self):
        self.applied = set(self.files)
        self.assertEqual(promote.apply_migrations(COMMIT), [])
        self.assertEqual((self.dumps, self.scripts), ([], []))

    def test_rejects_commit_not_on_main(self):
        for merge_base, ahead_by in (("b" * 40, 0), (COMMIT, 1)):
            self.merge_base, self.ahead_by = merge_base, ahead_by
            with self.assertRaises(ValueError):
                promote.apply_migrations(COMMIT)
        self.assertEqual((self.dumps, self.scripts), ([], []))

    def test_rejects_content_that_differs_from_the_listing(self):
        self.listed = {name: blob_id(data) for name, data in self.files.items()}
        self.files["20261201090000_add_b.sql"] = b"drop table a;\n"
        with self.assertRaises(ValueError):
            promote.apply_migrations(COMMIT)
        self.assertEqual((self.dumps, self.scripts), ([], []))

    def test_rejects_invalid_names(self):
        for extra in ("2026_short.sql", "20261201090000_Upper.sql", "20261201090000-dash.sql"):
            self.files = dict(self.FILES, **{extra: b"select 1;\n"})
            with self.assertRaises(ValueError):
                promote.apply_migrations(COMMIT)
        self.assertEqual((self.dumps, self.scripts), ([], []))

    def test_rejects_a_migration_that_commits_by_itself(self):
        self.files["20261201090000_add_b.sql"] = b"create table b (id int);\ncommit;\n"
        with self.assertRaises(ValueError):
            promote.apply_migrations(COMMIT)
        self.assertEqual((self.dumps, self.scripts), ([], []))

    def test_stops_at_the_first_failed_migration(self):
        self.fail_at = "006_reflection_feed_filters"
        with self.assertRaises(RuntimeError):
            promote.apply_migrations(COMMIT)
        self.assertEqual(self.scripts, [])


class DatabaseOutputTests(unittest.TestCase):
    def test_failed_step_keeps_database_output_out_of_the_message(self):
        import shutil
        import subprocess

        records = Path(tempfile.mkdtemp())
        saved_records, saved_run = promote.MIGRATION_RECORDS, promote.subprocess.run
        promote.MIGRATION_RECORDS = records / "migrations"
        promote.subprocess.run = lambda *args, **kwargs: subprocess.CompletedProcess(
            args, 3, b"", b"ERROR: duplicate key value (email)=(someone@example.com)\n")
        try:
            with self.assertRaises(RuntimeError) as raised:
                promote.psql("BEGIN;\nselect 1;\nCOMMIT;\n", "20261201090000")
            self.assertNotIn("someone@example.com", str(raised.exception))
            [log] = list((records / "migrations").iterdir())
            self.assertIn(b"someone@example.com", log.read_bytes())
            self.assertEqual(stat_mode(records / "migrations"), 0o700)
        finally:
            promote.MIGRATION_RECORDS, promote.subprocess.run = saved_records, saved_run
            shutil.rmtree(records)


def stat_mode(path):
    return path.stat().st_mode & 0o777


if __name__ == "__main__":
    unittest.main()
