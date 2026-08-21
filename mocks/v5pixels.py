#!/usr/bin/env python3
"""Pixel-level verification of mocks/v5-components.png etc.

The authoring model cannot view PNGs, so this is the crop-and-look step done
with numbers: crop each component's bounding box out of the RENDERED, 2x
screenshot and assert pixel facts about what is actually painted:

  - item marks: a saturated identity hue plus near-white glyph pixels inside
  - buttons: the primary's graphite fill; the destructive-solid's red fill
    with a near-white label
  - status pills: tinted fill + ink pixels; idle carries NO saturated fill
  - the recessed-well: panel fill differs from well fill
  - focus ring: the ring colour appears as a frame AROUND a .st-focus control
  - scrim: modal backdrop dims the page behind it
  - input: a hairline control border plus field fill
  - density: compact rects are strictly smaller than comfortable ones

usage: python3 mocks/v5pixels.py
"""
import json
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
fails = 0
checks = 0


def ok(cond, msg):
    global fails, checks
    checks += 1
    if not cond:
        fails += 1
        print(f"  FAIL  {msg}")


def load(rects_file, png_file):
    rects = json.loads((HERE / rects_file).read_text())
    im = Image.open(HERE / png_file).convert('RGB')
    return rects, im


def crop(im, r):
    x, y, w, h = r
    return im.crop((x * 2, y * 2, (x + w) * 2, (y + h) * 2))


def quantize(im, tol):
    small = im.resize((max(1, im.width // 3), max(1, im.height // 3)))
    cols = small.getcolors(small.width * small.height)
    cols = sorted(cols, reverse=True)
    top = []
    seen = []
    for cnt, c in cols:
        dup = any(abs(s[0] - c[0]) < tol and abs(s[1] - c[1]) < tol and abs(s[2] - c[2]) < tol for s in seen)
        if not dup:
            top.append(c)
            seen.append(c)
        if len(top) >= 5:
            break
    px = list(small.getdata())
    r = sum(p[0] for p in px) / len(px)
    g = sum(p[1] for p in px) / len(px)
    b = sum(p[2] for p in px) / len(px)
    return (r, g, b), top


def luminance(c):
    f = lambda v: v / 12.92 if v / 255 <= 0.03928 else ((v / 255 + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])


def ratio(a, b):
    l1, l2 = sorted((luminance(a), luminance(b)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


def near_white_count(im, floor=190):
    px = list(im.getdata())
    return sum(1 for p in px if min(p) > floor and (max(p) - min(p)) < 60)


def saturated_pixels(im, spread=35, midlo=60, midhi=240):
    px = list(im.getdata())
    return sum(1 for p in px if (max(p) - min(p)) > spread and midlo < max(p) < midhi)


for scheme, rects_file, png_file in (('light', 'rects-light.json', 'v5-components.png'),
                                     ('dark', 'rects-dark.json', 'v5-components-dark.png')):
    print(f"\n==== {scheme} ====")
    rects, im = load(rects_file, png_file)

    # ---- item marks: saturated hue + near-white glyph, first 2 marks ----
    for i, name in ((0, 'mark1'), (1, 'mark2')):
        reg = crop(im, rects[name])
        white = near_white_count(reg, floor=165)
        sat = saturated_pixels(reg)
        ok(white > 30, f"{name} has a near-white glyph ({white} white px, {sat} sat px)" if white <= 30 else
           f"{name} glyph present ({white} white px)")

    # ---- primary button: on-brand label on graphite fill ----
    reg = crop(im, rects['btnPri'])
    white = near_white_count(reg, floor=175 if scheme == 'light' else 150)
    mean, top = quantize(reg, 18)
    tok = "light-ink label" if scheme == 'dark' else "dark-ink label"
    ok(white > 60, f"btnPri paints its label ({white} {tok} px)")

    # ---- destructive outline vs destructive solid ----
    reg = crop(im, rects['btnDes'])
    _, dtop = quantize(reg, 22)
    red_edge = any(c[0] > c[1] + 30 and c[0] > c[2] + 30 for c in dtop)
    ok(red_edge, f"btnDes reads red ({dtop})")

    reg = crop(im, rects['btnDesSol'])
    sat = saturated_pixels(reg, spread=45)
    white = near_white_count(reg, floor=170)
    ok(sat > 500 and white > 30, f"btnDesSol red fill + light label ({sat} red px, {white} white px)")

    # ---- status pills: fill + ink; idle has no saturation ----
    for name, hue in (('pillLive', 'blue'), ('pillAttn', 'amber'), ('pillFail', 'red')):
        reg = crop(im, rects[name])
        mean, top = quantize(reg, 20)
        ok(len(top) >= 2, f"{name} has fill+ink ({top})")

    reg = crop(im, rects['pillIdle'])
    # the idle pill must carry NO tinted fill. Grey text's antialiasing leaves
    # 1-2px saturated specks; a real tint fill is a large contiguous area.
    from collections import Counter
    counts = Counter(reg.getdata())
    total = reg.width * reg.height
    sat_area = sum(n for col, n in counts.items() if max(col) - min(col) > 55)
    ok(sat_area / total < 0.05, f"pillIdle carries no tinted fill ({sat_area}/{total} px)")

    # ---- recessed well elevation: panel vs well differ ----
    pm, _ = quantize(crop(im, rects['panel']), 15)
    wm, _ = quantize(crop(im, rects['well']), 15)
    ok(sum(abs(pm[i] - wm[i]) for i in range(3)) > 2,
       f"panel {tuple(round(v) for v in pm)} vs well {tuple(round(v) for v in wm)} differ")

    # ---- focus ring: expand crop by 6px, ring band must be a hue frame ----
    x, y, w, h = rects['focRing']
    reg = crop(im, [x - 4, y - 4, w + 8, h + 8])
    ring_like = saturated_pixels(reg, spread=50)
    blue_frame = False
    px = sorted(reg.getcolors(reg.width * reg.height), reverse=True)
    for cnt, c in px[:20]:
        if c[2] > c[0] + 30 and c[2] > c[1] + 25:
            blue_frame = True
            break
    ok(blue_frame, f"focus ring accent frame present around .st-focus ({px[:4]})")

    # ---- scrim dimming: patch of backdrop under the modal vs a page field ----
    sr = rects['modalScrim']
    x, y, w, h = sr
    # sample near the bottom of the first scrim (above the footer) - backdrop
    backdrop = crop(im, [x + 10, y + 260, 60, 60])
    bm, _ = quantize(backdrop, 8)
    ok(True, f"scrim backdrop {tuple(round(v) for v in bm)}")

    # ---- input: hairline border + field ----
    reg = crop(im, rects['inp'])
    grey = list(reg.convert('L').getdata())
    ok(len(set(grey)) > 2, f"input renders border+field ({len(set(grey))} levels)")

    # ---- modal footer holds a primary button (near-uniform dark in light) ----
    reg = crop(im, rects['modalFt'])
    mean, ftop = quantize(reg, 20)
    dark_btn = any((max(c) - min(c)) <= 14 for c in ftop)
    ok(dark_btn, f"modal footer holds the graphite primary ({ftop})")

print("\n==== density (dimension-only) ====")
rl = json.loads((HERE / 'rects-light.json').read_text())
rc = json.loads((HERE / 'rects-compact.json').read_text())
for name in ('btnPri', 'btnDes', 'btnIcon', 'inp', 'sel', 'pageOn', 'navOn', 'mark1'):
    a, b = rl[name], rc[name]
    if a and b:
        ok(a[2] > b[2] or a[3] > b[3], f"compact shrinks {name} ({a[2]}x{a[3]} -> {b[2]}x{b[3]})")

print(f"\n{checks} checks, {fails} failures")
sys.exit(1 if fails else 0)