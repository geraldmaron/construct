#!/usr/bin/env python3
"""Read-only integrity/shape checks. Does not invoke a model or grade a producer."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'freeze-manifest.json').read_text())
for name, expected in manifest['sha256'].items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == expected, name
cases = json.loads((root / 'suite-cases.json').read_text())
assert len(cases) == 2
for case in cases:
    cid = case['id'].removeprefix('held-out-handback-')
    assert case['native']['prompt'] + '\n' == (root / 'prompts' / f'{cid}.txt').read_text()
    inputs = case['native']['files']
    assert len(inputs) == 5
    assert len({item['to'] for item in inputs}) == len(inputs)
    for item in inputs:
        assert item['from'].startswith(f'producer-inputs/{cid}/')
        assert (root / item['from']).is_file()
        assert item['to'] == Path(item['from']).name
    assert case['native']['rubric'] == f'private-grading/{cid}/rubric.txt'
    assert (root / case['native']['rubric']).is_file()
    assert case['native']['outputs'] == ['analysis.md']
    assert set(case['checks']) == {'correctness', 'uncertainty', 'evidence', 'method_application'}
    json.loads((root / 'private-grading' / cid / 'expected.json').read_text())

log = [json.loads(line) for line in (root / 'producer-inputs/seed-club/count-events.jsonl').read_text().splitlines()]
superseded = {e['supersedes'] for e in log if 'supersedes' in e}
current = {e['tray']: e['count'] for e in log if e['event_id'] not in superseded}
assert sum(current[t] for t in ['D1', 'D2']) == 120
assert sum(current[t] for t in ['S1', 'S2']) == 150
assert (150 - 120) / 120 == 0.25
assert (42 - 6) * 2 == 72
minutes = lambda n: 10 + 25 * n + 10 * (n - 1) + 10
assert minutes(2) == 80 and minutes(3) == 115
assert minutes(2) <= 100 < minutes(3)
assert minutes(3) <= 120 and (42 - 6) * 3 == 108
print(json.dumps({'integrity': 'ok', 'case_count': len(cases), 'frozen_file_count': len(manifest['sha256']), 'producer_runs': 0, 'qualification': 'not assessed'}, indent=2))
