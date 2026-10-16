#!/usr/bin/env python3
"""Compile the configured Android debug ABIs within the local Ralph memory limit."""
import os
from pathlib import Path

root = Path(__file__).resolve().parents[2]
cpus = set(sorted(os.sched_getaffinity(0))[:2])
os.sched_setaffinity(0, cpus)
os.chdir(root)
environment = dict(os.environ, JAVA_HOME="/usr/lib/jvm/java-21-openjdk-amd64",
                   ANDROID_HOME="/home/ehab/Android/Sdk")
command = [str(root / "android/gradlew"), "-p", "android", ":app:assembleDebug",
           "--no-daemon", "--max-workers=1"]
print(f"Android verification: CPUs {sorted(cpus)}, one Gradle worker, all configured ABIs.", flush=True)
os.execvpe(command[0], command, environment)
