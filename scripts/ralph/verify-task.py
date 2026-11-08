#!/usr/bin/env python3
"""Run a backlog task's full verification argv list once, stopping at the first failure.

Primary-direct mode (see docs/refactoring/RUNBOOK.md). Writes logs to .ralph/runs/<task>-primary-*
and a primary-verification-started event. Run it detached under the 6 GiB scope, for example:
systemd-run --user --unit=hafiz-verify-<task> --collect -p MemoryMax=6G -p MemorySwapMax=0 \
  -p WorkingDirectory=$PWD --setenv=PATH=$PATH --setenv=HOME=$HOME python3 -I scripts/ralph/verify-task.py RF-123
"""
import json, subprocess, sys, time, datetime
from pathlib import Path
root = Path(__file__).resolve().parents[2]
task_id = sys.argv[1]
task = next(t for t in json.loads((root/'docs/refactoring/backlog.json').read_text())['tasks'] if t['id']==task_id)
d = root/'.ralph/runs'/f'{task_id}-primary-{task.get("attempts",1)}-{time.time_ns()}'
d.mkdir(parents=True)
(d/'task.json').write_text(json.dumps(task, indent=2))
ev=[]
with (root/'.ralph/events.jsonl').open('a') as s:
    s.write(json.dumps({'time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'event':'primary-verification-started','task':task_id,'evidence':str(d.relative_to(root))})+'\n')
for i,cmd in enumerate(task['verification']):
    log=d/f'verify-{i}.log'
    t0=time.time()
    with log.open('w') as out:
        code=subprocess.call(cmd,cwd=root,stdout=out,stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,timeout=1800)
    ev.append({'argv':cmd,'exit':code,'seconds':round(time.time()-t0),'log':str(log.relative_to(root))})
    (d/'verification.json').write_text(json.dumps(ev,indent=2))
    print(f'[{i}] exit={code} {round(time.time()-t0)}s {" ".join(cmd)[:120]}', flush=True)
    if code:
        print(f'FAILED at {i}; see {log}'); sys.exit(1)
print(f'ALL {len(ev)} CHECKS PASSED; evidence {d}')
