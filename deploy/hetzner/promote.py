#!/usr/bin/python3
"""Validate and atomically install a static release, with health rollback.

Before the swap it applies the release's unrecorded database migrations. It reads them from
GitHub at the release commit, not from the uploaded archive, so the web deploy key can trigger
only SQL that is already reviewed on main.
"""
from datetime import datetime, timezone
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

MAX_ARCHIVE = 512 * 1024 * 1024
MAX_EXPANDED = 1536 * 1024 * 1024
ROOT = Path("/opt/hafiz")
REQUIRED = {"dist/index.html", "dist/__release.json", "dist/NOTICE.md", "SHA256SUMS"}

GITHUB_API = "https://api.github.com/repos/71iq/Hafiz"
GITHUB_RAW = "https://raw.githubusercontent.com/71iq/Hafiz"
MIGRATIONS = "supabase/migrations"
# Eight early files use three-digit prefixes and two share 006, so history keys on the file name.
MIGRATION_FILE = re.compile(r"[0-9]{3}(?:[0-9]{11})?_[a-z0-9_]+\.sql")
MAX_LISTING = 4 * 1024 * 1024
MAX_MIGRATION = 2 * 1024 * 1024
# Root-only. Holds a database dump before each batch and the database output of a failed
# migration, which can quote row values and so stays out of the public Actions log.
MIGRATION_RECORDS = Path("/var/backups/hafiz/migrations")
KEPT_MIGRATION_DUMPS = 10
# postgres owns the application's tables and functions and holds the supautils grants for auth
# and storage policies. Objects a superuser creates would run SECURITY DEFINER code as superuser.
PSQL = ["docker", "exec", "-i", "hafiz-db", "psql", "-U", "postgres", "-d", "postgres",
        "-X", "-q", "-v", "ON_ERROR_STOP=1"]
HISTORY = "hafiz_deploy.migrations"
# PL/pgSQL blocks use BEGIN without a semicolon and END; so neither form matches here.
TRANSACTION_CONTROL = re.compile(r"^\s*(begin|commit|rollback|start\s+transaction)\s*;",
                                 re.IGNORECASE | re.MULTILINE)


def checked_members(archive):
    members, found, regular = [], set(), set()
    total = 0
    for member in archive:
        members.append(member)
        name = member.name.rstrip("/")
        parts = name.split("/")
        hidden = any(part.startswith(".") for part in parts)
        if (len(members) > 30000 or not name or name.startswith("/") or "\\" in name
                or any(part in ("", ".", "..") for part in parts)
                or (hidden and name != "dist/_expo/.routes.json")
                or not (parts[0] == "dist" or name == "SHA256SUMS")
                or not (member.isfile() or member.isdir()) or member.size < 0
                or name in found):
            raise ValueError("Invalid runtime archive entry")
        total += member.size
        if total > MAX_EXPANDED:
            raise ValueError("Expanded archive exceeds limit")
        found.add(name)
        if member.isfile():
            regular.add(name)
    if not REQUIRED.issubset(regular):
        raise ValueError("Incomplete runtime archive")
    return members


def expand_archive(source, destination):
    with gzip.GzipFile(fileobj=source) as compressed:
        while chunk := compressed.read(1024 * 1024):
            if destination.tell() + len(chunk) > MAX_EXPANDED:
                raise ValueError("Expanded archive exceeds limit")
            destination.write(chunk)
    destination.seek(0)


def extract_runtime(archive, destination):
    for member in checked_members(archive):
        target = destination / member.name
        if member.isdir():
            target.mkdir(parents=True, exist_ok=True, mode=0o755)
        else:
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            with archive.extractfile(member) as source, target.open("xb") as output:
                shutil.copyfileobj(source, output)
            target.chmod(0o644)


def verify_runtime(destination, sha):
    actual = {str(item.relative_to(destination)) for item in (destination / "dist").rglob("*") if item.is_file()}
    verified = set()
    for line in (destination / "SHA256SUMS").read_text().splitlines():
        match = re.fullmatch(r"([a-f0-9]{64})  (dist/[^\r\n]+)", line)
        if not match:
            raise ValueError("Invalid checksum manifest")
        digest, name = match.groups()
        if name not in actual or name in verified:
            raise ValueError("Invalid checksum path")
        with (destination / name).open("rb") as file:
            if hashlib.file_digest(file, "sha256").hexdigest() != digest:
                raise ValueError("Runtime checksum mismatch")
        verified.add(name)
    if verified != actual:
        raise ValueError("Incomplete checksum manifest")
    if json.loads((destination / "dist/__release.json").read_text()).get("commit") != sha:
        raise ValueError("Release commit mismatch")


def swap(path):
    temporary = ROOT / "current.next"
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(path)
    temporary.replace(ROOT / "current")


def health(sha):
    with urllib.request.urlopen("http://127.0.0.1:8081/__release.json", timeout=10) as response:
        if json.load(response).get("commit") != sha:
            raise RuntimeError("Web release health check failed")
    with urllib.request.urlopen("http://127.0.0.1:8081/", timeout=10) as response:
        if response.status != 200 or b"<html" not in response.read():
            raise RuntimeError("Web document health check failed")


def fetch(url, limit):
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json",
                                                   "User-Agent": "hafiz-promote"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Download exceeds limit")
    return data


def released_migrations(sha):
    """Return (file name, git blob id) for each migration at a commit on main, in name order."""
    # With main as the base, the comparison is empty exactly when the commit is on main.
    comparison = json.loads(fetch(f"{GITHUB_API}/compare/main...{sha}", MAX_LISTING))
    if comparison.get("merge_base_commit", {}).get("sha") != sha or comparison.get("ahead_by") != 0:
        raise ValueError("Release commit is not on main")
    found = {}
    for item in json.loads(fetch(f"{GITHUB_API}/contents/{MIGRATIONS}?ref={sha}", MAX_LISTING)):
        name = item.get("name", "")
        if item.get("type") != "file" or not name.endswith(".sql"):
            continue
        if not MIGRATION_FILE.fullmatch(name) or not re.fullmatch("[a-f0-9]{40}", item.get("sha", "")):
            raise ValueError("Invalid migration file name")
        found[name] = item["sha"]
    return sorted(found.items())


def migration_sql(sha, name, blob):
    data = fetch(f"{GITHUB_RAW}/{sha}/{MIGRATIONS}/{name}", MAX_MIGRATION)
    if hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest() != blob:
        raise ValueError("Migration content does not match GitHub's listing: " + name)
    sql = data.decode("utf-8")
    if TRANSACTION_CONTROL.search(sql):
        raise ValueError("Migration controls its own transaction: " + name)
    return sql


def psql(script, label, *options):
    result = subprocess.run(PSQL + list(options), input=script.encode(), capture_output=True, timeout=900)
    if result.returncode != 0:
        MIGRATION_RECORDS.mkdir(mode=0o700, parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        log = MIGRATION_RECORDS / f"{stamp}-{label}.log"
        log.write_bytes(result.stdout + result.stderr)
        raise RuntimeError(f"Database step {label} failed and was rolled back; output in {log}")
    return result.stdout.decode()


def applied_migrations():
    # Fails when the history table is missing: without it every file would replay.
    return set(psql(f"SELECT file FROM {HISTORY};\n", "history", "-At").split())


def dump_database(name):
    MIGRATION_RECORDS.mkdir(mode=0o700, parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = MIGRATION_RECORDS / f"{stamp}-before-{name[:-4]}.dump"
    with target.open("xb") as output:
        subprocess.run(["docker", "exec", "hafiz-db", "pg_dump", "-U", "supabase_admin", "-d", "postgres",
                        "--format=custom"], stdout=output, stderr=subprocess.DEVNULL, check=True, timeout=1800)
    for old in sorted(MIGRATION_RECORDS.glob("*.dump"))[:-KEPT_MIGRATION_DUMPS]:
        old.unlink()
    return target


def apply_migrations(sha):
    """Apply each migration missing from the history table, in name order, one transaction each."""
    applied = applied_migrations()
    pending = [item for item in released_migrations(sha) if item[0] not in applied]
    if not pending:
        print("No pending database migrations")
        return []
    # Download and check every file before the database changes.
    scripts = [(name, blob, migration_sql(sha, name, blob)) for name, blob in pending]
    print("Database dump before migrating: " + str(dump_database(pending[0][0])))
    for name, blob, sql in scripts:
        # The name matches MIGRATION_FILE and the blob id is hexadecimal, so both are safe in SQL.
        psql("BEGIN;\nSET LOCAL lock_timeout = '10s';\nSET LOCAL statement_timeout = '5min';\n"
             + sql + f"\n;\nINSERT INTO {HISTORY} (file, git_blob) VALUES ('{name}', '{blob}');\n"
             + "NOTIFY pgrst, 'reload schema';\nCOMMIT;\n", name[:-4])
        print("Applied migration " + name)
    return [name for name, _, _ in scripts]


def main():
    if os.geteuid() != 0 or len(sys.argv) != 3 or not re.fullmatch("[a-f0-9]{40}", sys.argv[1]):
        raise ValueError("Expected root, commit and archive path")
    sha, supplied = sys.argv[1:]
    incoming = Path("/var/lib/hafizdeploy/incoming")
    path = Path(supplied)
    if not path.is_absolute() or path.parent.parent != incoming or path.name != "runtime.tar.gz":
        raise ValueError("Invalid incoming path")
    account = pwd.getpwnam("hafizdeploy")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    metadata = os.fstat(fd)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != account.pw_uid or not 0 < metadata.st_size <= MAX_ARCHIVE:
        os.close(fd)
        raise ValueError("Invalid archive ownership or size")
    with open("/run/hafiz/operation.lock", "r+") as lock, os.fdopen(fd, "rb") as source:
        fcntl.flock(lock, fcntl.LOCK_EX)
        target = ROOT / "releases" / sha
        if target.exists():
            if (ROOT / "current").resolve() == target:
                # Repeating the live commit's deploy applies its pending migrations, for example after a failure.
                apply_migrations(sha)
                health(sha)
                print("Release already active")
                return
            raise ValueError("Release already exists")
        if shutil.disk_usage(ROOT).free < 5 * 1024 * 1024 * 1024:
            raise ValueError("Less than 5 GiB free; refusing deployment")
        temporary = Path(tempfile.mkdtemp(prefix=".incoming-", dir=ROOT / "releases"))
        try:
            # Copy to a root-owned file so the deploy user cannot change the input
            # after validation or grow it while decompression runs.
            with tempfile.TemporaryFile() as snapshot, tempfile.TemporaryFile() as expanded:
                while chunk := source.read(1024 * 1024):
                    if snapshot.tell() + len(chunk) > MAX_ARCHIVE:
                        raise ValueError("Archive exceeds limit")
                    snapshot.write(chunk)
                snapshot.seek(0)
                expand_archive(snapshot, expanded)
                with tarfile.open(fileobj=expanded, mode="r:") as archive:
                    extract_runtime(archive, temporary)
            verify_runtime(temporary, sha)
            # The database changes before the new web goes live, so the release can call what the
            # migrations add. A failed migration rolls back alone and stops the deploy with the
            # current web still live; earlier migrations in the batch stay applied, as they do
            # when a later health check restores the previous web.
            apply_migrations(sha)
            for parent, _, _ in os.walk(temporary):
                os.chmod(parent, 0o755)
            temporary.rename(target)
        finally:
            if temporary.exists():
                shutil.rmtree(temporary)
        current = ROOT / "current"
        old = current.resolve() if current.exists() else None
        swap(target)
        try:
            health(sha)
        except Exception:
            if old is not None:
                swap(old)
            else:
                current.unlink()
            raise
        print("Promoted " + sha)
        # Keep five releases, including the previous version.
        retained = sorted((item for item in (ROOT / "releases").iterdir()
                           if re.fullmatch("[a-f0-9]{40}", item.name) and item.is_dir() and not item.is_symlink()),
                          key=lambda item: item.stat().st_mtime, reverse=True)
        for item in retained[5:]:
            if item != target and item != old:
                shutil.rmtree(item)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Deployment failed: " + str(error), file=sys.stderr)
        sys.exit(1)
