#!/usr/bin/env python3
"""DW-3.12 — "saturated colour appears only on chips, badges and small marks;
no large surface is saturated."

Counted, not asserted: every pixel's sRGB saturation (max-min), then the area of
the largest connected saturated region. A saturated *wash* would show up as one
big component; chips and marks show up as many small ones.
"""
import sys
import numpy as np
from PIL import Image

THRESH = 20          # channel spread that counts as "carrying a hue"
# A CEILING AND A FLOOR. This was reported as "2.342% — calm is a budget" and
# every further desaturation scored better, which is how the marks ended up
# graphite and the board ended up dead. A fleet console with 0% hue is as wrong
# as one with 40%: colour here is information, not decoration.
FLOOR, CEIL = 1.0, 12.0
bad = []
for path in sys.argv[1:]:
    im = Image.open(path).convert('RGB')
    if im.width > 2000:
        im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
    a = np.asarray(im).astype(int)
    sat = (a.max(axis=2) - a.min(axis=2)) >= THRESH
    total = sat.size
    # largest connected component, 4-connectivity, iterative flood fill
    seen = np.zeros_like(sat, dtype=bool)
    biggest, blobs = 0, 0
    ys, xs = np.nonzero(sat)
    H, W = sat.shape
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        blobs += 1
        stack, n = [(y0, x0)], 0
        seen[y0, x0] = True
        while stack:
            y, x = stack.pop()
            n += 1
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < H and 0 <= xx < W and sat[yy, xx] and not seen[yy, xx]:
                    seen[yy, xx] = True
                    stack.append((yy, xx))
        biggest = max(biggest, n)
    print(f"{path}")
    print(f"  saturated pixels : {sat.sum():>8} / {total}  = {100*sat.sum()/total:.3f}% of the surface")
    print(f"  saturated regions: {blobs:>8}")
    print(f"  largest region   : {biggest:>8} px = {100*biggest/total:.4f}% of the surface"
          f"  ({'OK — chip/mark scale' if 100*biggest/total < 0.5 else 'LARGE SATURATED SURFACE'})")
    pct = 100 * sat.sum() / total
    verdict = ('BELOW FLOOR — the surface has gone grey' if pct < FLOOR
               else 'ABOVE CEILING — colour has become a wash' if pct > CEIL
               else f'within {FLOOR}-{CEIL}%')
    print(f"  hue budget       : {pct:>8.3f}%  [floor {FLOOR}% · ceiling {CEIL}%]  {verdict}")
    if pct < FLOOR or pct > CEIL:
        bad.append(path)

import sys as _s
if bad:
    print(f"  {len(bad)} image(s) outside the hue budget")
    _s.exit(1)
print("  hue budget holds on every image")
