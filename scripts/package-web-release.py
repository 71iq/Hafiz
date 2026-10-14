#!/usr/bin/env python3
"""Package the Expo export without source, credentials or native build files."""
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile

root = Path(__file__).resolve().parent.parent
sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
if not re.fullmatch("[a-f0-9]{40}", sha) or len(sys.argv) != 2:
    sys.exit("Usage: python3 scripts/package-web-release.py /absolute/runtime.tar.gz")
dist = root / "dist"
if not (dist / "index.html").is_file():
    sys.exit("Build the web export first")
shutil.copyfile(root / "NOTICE.md", dist / "NOTICE.md")
(dist / "__release.json").write_text(json.dumps({"commit": sha}) + "\n")
entries = []
for item in sorted(dist.rglob("*")):
    if item.is_symlink():
        sys.exit("Release contains a symbolic link")
    if item.is_file():
        with item.open("rb") as file:
            entries.append(f"{hashlib.file_digest(file, 'sha256').hexdigest()}  {item.relative_to(root)}\n")
manifest = "".join(entries).encode()
with tarfile.open(sys.argv[1], "w:gz") as archive:
    archive.add(dist, arcname="dist")
    info = tarfile.TarInfo("SHA256SUMS")
    info.size = len(manifest)
    info.mode = 0o644
    archive.addfile(info, io.BytesIO(manifest))
print(json.dumps({"commit": sha, "files": len(entries), "bytes": Path(sys.argv[1]).stat().st_size}))
