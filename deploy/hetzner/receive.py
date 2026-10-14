#!/usr/bin/python3
"""Accept a web release through a forced SSH command."""
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

match = re.fullmatch(r"deploy ([a-f0-9]{40})", os.environ.get("SSH_ORIGINAL_COMMAND", ""))
if not match:
    sys.exit("Only a deployment command is accepted")
os.umask(0o077)
with tempfile.TemporaryDirectory(dir="/var/lib/hafizdeploy/incoming") as folder:
    archive = Path(folder) / "runtime.tar.gz"
    total = 0
    with archive.open("xb") as output:
        while chunk := sys.stdin.buffer.read(1024 * 1024):
            total += len(chunk)
            if total > 512 * 1024 * 1024:
                sys.exit("Archive exceeds limit")
            output.write(chunk)
    subprocess.run(["/usr/bin/sudo", "-n", "/usr/local/sbin/hafiz-promote",
                    match[1], str(archive)], check=True)
