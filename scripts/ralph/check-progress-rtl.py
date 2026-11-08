#!/usr/bin/env python3
"""Prove ProgressScreen RTL assertions reject incorrect rendered styles."""
import hashlib
import json
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'app/(tabs)/progress.tsx'
TEST = ROOT / 'tests/unit/progress-screen-rtl.test.tsx'
REPORTS = ROOT / '.refactor-baseline/rf005-mutations'


def main():
    output_dir = REPORTS / str(time.time_ns())
    original = SOURCE.read_bytes()
    test_before = TEST.read_bytes()
    source = original.decode()
    marker = 'style={mirroredRowStyle}'
    parts = source.split(marker)
    if len(parts) != 4:
        raise RuntimeError('ProgressScreen row structure changed. Review this mutation check.')
    output_dir.mkdir(parents=True)
    results = []
    for name, replacement in {
        'inner-direction': 'style={{ ...mirroredRowStyle, direction: "rtl" }}',
        'inner-order': 'style={{ ...mirroredRowStyle, flexDirection: isRTL ? "row" : "row-reverse" }}',
    }.items():
        # Only the inner title/icon row changes. The outer row stays correct.
        candidate = output_dir / f'{name}.tsx'
        candidate.write_text(parts[0] + marker + parts[1] + replacement + parts[2] + marker + parts[3])
        config = output_dir / f'{name}.config.cjs'
        mapper = {r'^@/app/\(tabs\)/progress$': str(candidate), '^@/(.*)$': '<rootDir>/$1'}
        config.write_text('module.exports = { ...require(' + json.dumps(str(ROOT / 'jest.config.js'))
                          + '), rootDir: ' + json.dumps(str(ROOT))
                          + ', moduleNameMapper: ' + json.dumps(mapper) + ' };\n')
        command = ['npm', 'run', 'test:unit', '--', '--config', str(config),
                   '--runTestsByPath', str(TEST)]
        log = output_dir / f'{name}.log'
        with log.open('w') as stream:
            completed = subprocess.run(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT, timeout=120)
        output = log.read_text()
        caught = completed.returncode == 1 and 'toMatchObject' in output and 'Tests:       1 failed' in output
        results.append({'mutation': name, 'argv': command, 'exit': completed.returncode,
                        'rejected_by_style_assertion': caught, 'log': str(log.relative_to(ROOT))})
    unchanged = SOURCE.read_bytes() == original and TEST.read_bytes() == test_before
    summary = {'source_sha256': hashlib.sha256(original).hexdigest(),
               'test_sha256': hashlib.sha256(test_before).hexdigest(),
               'source_and_assertions_unchanged': unchanged, 'results': results}
    report = json.dumps(summary, indent=2) + '\n'
    (output_dir / 'summary.json').write_text(report)
    (REPORTS / 'summary.json').write_text(report)
    if not unchanged or not all(r['rejected_by_style_assertion'] for r in results):
        raise RuntimeError(f'Mutation sensitivity failed. Inspect {output_dir.relative_to(ROOT)}/summary.json')
    print('Both incorrect inner-row styles failed unchanged assertions; application source preserved.')


if __name__ == '__main__':
    main()
