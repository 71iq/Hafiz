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


if __name__ == "__main__":
    unittest.main()
