#!/usr/bin/env bash
# Build the three mocks from their pristine sources, in one command.
#
# The pipeline used to be two steps I ran by hand (retoken.py, then
# statuschips.py) against sources kept in /tmp. Both halves of that are
# fragile: a rebuild that skipped the second step silently shipped mocks with
# no status glyphs, and /tmp does not survive a reboot. Sources now live in
# mocks/src/ and the whole pipeline is this file.
set -euo pipefail
cd "$(dirname "$0")"
# v5 — the Phase 4 component library — is authored already tokenised (its <style>
# references alias tokens only), so the retoken/statuschips/a11y rewrite passes
# — which are count-matched to the product mocks — are NOT run on it. It is
# copied here so the solarize pass below (which loops over v5-components.html)
# can inline its {{solar:NAME}} placeholders, the same as the other three.
# v5-components and v5-agent are authored already tokenised (their <style> blocks
# reference alias tokens only), so the retoken/statuschips/a11y rewrite passes —
# which are count-matched to the product mocks — are NOT run on them. They are
# copied here so the solarize pass below (which loops over each) can inline the
# {{solar:NAME}} placeholders, the same as the other four.
cp src/v5-components.html v5-components.html
cp src/v5-agent.html v5-agent.html
cp src/v5-data.html v5-data.html
for f in v2-fleet.html v3-assistant.html v4-transcript.html; do cp "src/$f" "$f"; done
python3 retoken.py
python3 statuschips.py
python3 a11y.py
python3 solarize.py
node build-tokens.mjs
node resolve-tokens.mjs
# render the v5 component library (the gallery is taller than one screen)
node render.mjs v5-components.html v5-components.png --viewport 1440x5600
node render.mjs v5-components.html v5-components-dark.png --dark --viewport 1440x5600
node render.mjs v5-components.html v5-components-mobile.png --viewport 390x10400
# render the v5 agent surface at compact density (the surface, failure modes and
# the 8-state gallery are taller than one screen) in light, dark, and the
# mobile/compact view for the coarse-pointer target sweep
node render.mjs v5-agent.html v5-agent.png --viewport 1440x4000
node render.mjs v5-agent.html v5-agent-dark.png --dark --viewport 1440x4000
node render.mjs v5-agent.html v5-agent-mobile.png --viewport 390x5200
# render the v5 data surfaces (table system / stat cards / charts / meters) at
# comfortable density in light and dark, and the narrow view for the coarse sweep
node render.mjs v5-data.html v5-data.png --viewport 1440x1800
node render.mjs v5-data.html v5-data-dark.png --dark --viewport 1440x1800
node render.mjs v5-data.html v5-data-mobile.png --viewport 390x3600
echo "built 6 mocks from mocks/src/"
