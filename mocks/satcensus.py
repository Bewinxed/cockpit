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
