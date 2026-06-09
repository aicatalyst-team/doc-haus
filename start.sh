#!/usr/bin/env bash
# doc.haus launcher — starts the three processes the stack needs as one command:
#   1. the unmodified opencode engine, pointed at the dochaus/ legal config layer
#   2. the ingest service (matters + DOCX embedding + redlines)
#   3. the web app
# This is additive (upstream has no start.sh) so it never affects `git merge upstream/dev`.
set -euo pipefail
cd "$(dirname "$0")"

# Required env. WORKSPACE_ROOT is where matters live (independent of this repo).
# The shipped default provider is Google Vertex via ADC; swap the provider block in
# dochaus/opencode.json to use another and these Vertex vars become irrelevant.
: "${WORKSPACE_ROOT:?set WORKSPACE_ROOT to the directory where matters should live}"
: "${GOOGLE_VERTEX_PROJECT:?set GOOGLE_VERTEX_PROJECT (or reconfigure the provider in dochaus/opencode.json)}"
export GOOGLE_VERTEX_LOCATION="${GOOGLE_VERTEX_LOCATION:-global}"

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "doc.haus: starting engine, ingest, web (workspace: $WORKSPACE_ROOT)"

OPENCODE_CONFIG_DIR="$PWD/dochaus" bun run packages/opencode/src/index.ts serve &
pids+=($!)

(cd services/ingest && bun run start) &
pids+=($!)

(cd apps/web && bun run dev) &
pids+=($!)

# Block until interrupted (Ctrl-C), then the trap tears every process down. Plain
# `wait` keeps this portable to the bash 3.2 that ships on macOS (`wait -n` is 4.0+).
wait
