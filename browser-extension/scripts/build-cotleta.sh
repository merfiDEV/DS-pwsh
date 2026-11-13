#!/usr/bin/env bash
# Build a single self-contained executable: pkg(host.js) + PyInstaller(rich-log.py).
set -euo pipefail

cd "$(dirname "$0")/.."
DIST="${DIST:-dist}"
OUT="${OUT:-$DIST/ds-pwsh-bridge}"
TARGET="${TARGET:-node18-linux-x64}"

if [ -x bridge/.rich-venv/bin/python ]; then
  PY=bridge/.rich-venv/bin/python
elif [ -x bridge/.rich-venv/Scripts/python.exe ]; then
  PY=bridge/.rich-venv/Scripts/python.exe
else
  PY=python3
fi

echo "[build] PyInstaller rich-log" 
"$PY" -m PyInstaller --onefile --name rich-log --clean --distpath "$DIST/py" --workpath "$DIST/pybuild" --specpath "$DIST/py" bridge/rich-log.py

RICH="$DIST/py/rich-log"
if [ -f "$DIST/py/rich-log.exe" ]; then RICH="$DIST/py/rich-log.exe"; fi

echo "[build] pkg host.js"
rm -rf "$DIST/pkg"
npx pkg bridge/host.js --targets "$TARGET" --out-path "$DIST/pkg"
HOST=$(find "$DIST/pkg" -maxdepth 1 -type f | head -1)

echo "[build] stitch"
node scripts/stitch.js "$HOST" "$RICH" "$OUT"
echo "[build] done: $OUT"
