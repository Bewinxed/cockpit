#!/usr/bin/env python3
"""Container-level verification of detect.mjs's `nested-cards` findings.

A raw count from detect.mjs is not a signal on this codebase. The rule fires on
any element carrying a border + radius + background that sits inside another such
element, so every button, input, select and pill in the file matches — the plan
recorded ~77 of these false positives before this phase started. Each finding is
therefore classified by what the element actually IS, and only a genuine
uniform-padding card-in-card counts.

usage: node .../detect.mjs <files> > detect.json && python3 mocks/detectcheck.py detect.json
"""
import json
import re
import sys

# controls, not containers: a 32px button with a border is not a nested card
CONTROL = re.compile(
    r'class="[^"]*\b('
    r'ghost|icobtn|search|sel|a-orb|a-composer|a-send|stop|btn|pill|chip|chip-s|key|pg'
    r')\b'
)
CONTROL_TAG = re.compile(r'<(button|input|select|textarea|a)\b')

data = json.load(open(sys.argv[1]))
findings = data.get('findings', [])
rules = sorted({f['rule'] for f in findings})

controls, real = [], []
for f in findings:
    ev = f['evidence']
    (controls if (CONTROL.search(ev) or CONTROL_TAG.search(ev)) else real).append(f)

print(f"  detect.mjs findings: {len(findings)}   rules fired: {rules or 'none'}")
print(f"  controls (button / input / select / orb / composer / pill): "
      f"{len(controls)}  -> false positives, per the documented rule behaviour")
print(f"  genuine uniform-padding card-in-card:                       {len(real)}")
for f in real:
    print(f"    REAL: {f['source']} L{f['line']} {f['evidence']}")

# The stat card IS a nested surface and is deliberately not flagged — it is a
# recessed well (different inset, fill and radius), which is this DNA's signature
# move and is explicitly permitted by DESIGN.md's ## Never list.
sys.exit(1 if real else 0)
