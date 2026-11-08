#!/usr/bin/env python3
"""Print a short modernization status from backlog.json and events.jsonl (for 3-hourly updates)."""
import json, sys, datetime
from pathlib import Path
root = Path(__file__).resolve().parents[2]
since = sys.argv[1] if len(sys.argv) > 1 else None  # ISO time; default: last 3 hours
if since is None:
    since = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=3)).isoformat()
tasks = {t['id']: t for t in json.loads((root / 'docs/refactoring/backlog.json').read_text())['tasks']}
events = [json.loads(l) for l in (root / '.ralph/events.jsonl').read_text().splitlines() if l.strip()]
accepted = [e for e in events if e.get('event') == 'primary-accepted' and e.get('time', '') >= since]
counts = {}
for t in tasks.values():
    counts[t['status']] = counts.get(t['status'], 0) + 1
print(f"Status: {', '.join(f'{v} {k}' for k, v in sorted(counts.items()))}")
for e in accepted:
    t = tasks.get(e['task'], {})
    print(f"- {e['task']} {e.get('commit', '')[:7]}: {t.get('title', '')}")
running = [t for t in tasks.values() if t['status'] in ('running', 'retry')]
for t in running:
    print(f"In progress: {t['id']} {t['title']}")
waiting = [t for t in tasks.values() if t['status'] == 'blocked' or t.get('waiting_on_user')]
for t in waiting:
    print(f"Needs Ehab: {t['id']} {t.get('waiting_on_user') or t['title']}")
cp = json.loads((root / 'docs/refactoring/backlog.json').read_text()).get('checkpoint')
if cp:
    print(f"Last green commit: {cp.get('last_green_commit')}")
