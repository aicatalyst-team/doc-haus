#!/usr/bin/env bash
# Runs inside the fresh-clone container. Mirrors the dochaus slice of
# start.sh's install loop, then asserts the config-layer dependencies the
# legal tools import at runtime actually landed on disk.
set -euo pipefail

echo "== fresh clone contents (tracked files only) =="
test -f dochaus/package.json || { echo "FAIL: dochaus/package.json missing — manifest not tracked (#42)"; exit 1; }
test -f dochaus/bun.lock     || { echo "FAIL: dochaus/bun.lock missing — lockfile not tracked (#42)"; exit 1; }
test -f dochaus/patches/docxodus@6.4.0.patch || { echo "FAIL: docxodus patch missing"; exit 1; }
echo "OK: package.json, bun.lock, patches/ all present"

echo "== bun install --frozen-lockfile (dochaus) =="
# Exactly what start.sh runs for the dochaus config layer. --frozen-lockfile
# fails loudly if the lockfile is absent or has drifted from package.json.
(cd dochaus && bun install --frozen-lockfile)

echo "== assert config-layer deps resolved =="
for dep in @xenova/transformers docxodus mammoth unpdf @opencode-ai/plugin; do
  test -d "dochaus/node_modules/$dep" || { echo "FAIL: $dep did not install"; exit 1; }
  echo "OK: $dep"
done

echo "== assert docxodus patch applied =="
# The patch strips the wasmSymbols block from blazor.boot.json; if patching
# silently no-op'd, that block would still be there.
boot=dochaus/node_modules/docxodus/dist/wasm/_framework/blazor.boot.json
test -f "$boot" || { echo "FAIL: $boot missing"; exit 1; }
if grep -q '"wasmSymbols"' "$boot"; then
  echo "FAIL: docxodus patch did not apply (wasmSymbols still present)"
  exit 1
fi
echo "OK: docxodus patch applied (wasmSymbols removed)"

echo
echo "PASS: fresh clone installs the dochaus config layer cleanly."
