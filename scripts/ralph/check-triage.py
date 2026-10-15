import json
from pathlib import Path
root = Path(__file__).resolve().parents[2]
source = json.loads((root / 'docs/refactoring/analysis-summary.json').read_text())['clones']
triage = json.loads((root / 'docs/refactoring/duplication-triage.json').read_text())
rows = triage['groups']
assert len(rows) == len(source), 'Every measured clone needs a decision'
assert {r['index'] for r in rows} == set(range(len(source))), 'Clone indexes must be complete and unique'
for row in rows:
    assert row['decision'] in ['refactor', 'intentional', 'needs-characterization']
    assert len(row['rationale'].strip()) >= 20, 'Give a concrete semantic reason'
    assert row['files'] == [source[row['index']]['firstFile']['name'], source[row['index']]['secondFile']['name']]
    if row['decision'] != 'intentional':
        assert row.get('follow_up'), 'Actionable groups need a small follow-up'
print(f'{len(rows)} clone decisions checked. This validates coverage, not correctness of each decision.')
