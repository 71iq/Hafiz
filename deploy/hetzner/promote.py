#!/usr/bin/python3
"""Validate and atomically install a static release, with health rollback."""
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
import sys
import tarfile
import tempfile
import urllib.request

MAX_ARCHIVE = 512 * 1024 * 1024
MAX_EXPANDED = 1536 * 1024 * 1024
ROOT = Path("/opt/hafiz")
REQUIRED = {"dist/index.html", "dist/__release.json", "dist/NOTICE.md", "SHA256SUMS"}


def checked_members(archive):
    members, found, regular = [], set(), set()
    total = 0
    for member in archive:
        members.append(member)
        name = member.name.rstrip("/")
        parts = name.split("/")
        if (len(members) > 30000 or not name or name.startswith("/") or "\\" in name
                or any(part in ("", ".", "..") or part.startswith(".") for part in parts)
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
