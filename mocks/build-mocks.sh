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
for f in v2-fleet.html v3-assistant.html v4-transcript.html; do cp "src/$f" "$f"; done
python3 retoken.py
python3 statuschips.py
python3 a11y.py
node build-tokens.mjs
node resolve-tokens.mjs
echo "built 3 mocks from mocks/src/"
