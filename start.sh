#!/usr/bin/env bash
# doc.haus launcher — starts the three processes the stack needs as one command:
#   1. the unmodified opencode engine, pointed at the dochaus/ legal config layer
#   2. the ingest service (matters + DOCX embedding + redlines)
#   3. the web app
# This is additive (upstream has no start.sh) so it never affects `git merge upstream/dev`.
set -euo pipefail
cd "$(dirname "$0")"

# --demo seeds the fictional Aldgate Mills letter of engagement before launch, so a
# first run lands on a matter with cited Q&A and a legal review without uploading
# anything. The seed is idempotent — pass it on every boot, it only ingests once.
DEMO=
for arg in "$@"; do
  [ "$arg" = "--demo" ] && DEMO=1
done

# WORKSPACE_ROOT is where matters live. Defaults to ./workspace at the repo root
# (gitignored) like opencode defaults its project dir to process.cwd() — set it to
# an absolute path to keep matters outside the repo.
export WORKSPACE_ROOT="${WORKSPACE_ROOT:-$PWD/workspace}"
mkdir -p "$WORKSPACE_ROOT"

# No provider env is required to launch: the engine reads provider credentials
# lazily, and you connect a provider + pick a model in the web UI (Settings) on
# first run. These two are only consumed if you choose the bundled Google Vertex
# provider — set GOOGLE_VERTEX_PROJECT then, or leave them unset for any other.
export GOOGLE_VERTEX_LOCATION="${GOOGLE_VERTEX_LOCATION:-global}"

# Install dependencies before launch so a fresh clone just works. The engine runs
# from the repo-root workspace; dochaus (its config-layer tools), the ingest
# service, and the web app each carry their own lockfile, so each needs its own
# install. bun install is idempotent and fast once a lockfile is satisfied, so
# running it every launch also picks up a pulled change to any package.json with
# no manual step. Set SKIP_INSTALL=1 to skip it on quick restarts.
if [ -z "${SKIP_INSTALL:-}" ]; then
  for dir in . dochaus services/ingest apps/web; do
    echo "doc.haus: installing dependencies ($dir)"
    (cd "$dir" && bun install)
  done
fi

# The three fixed ports the stack binds: engine (web hardcodes :4096), ingest
# (services/ingest defaults :4500), web (vite :5173). The engine prefers 4096 but
# silently falls back to a random port when 4096 is taken — the web app can only
# reach 4096, so a stale listener there produces a "ghost engine" the UI talks to
# while the fresh engine sits unreachable. Pin and reap to make that impossible.
PORTS=(4096 4500 5173)

# pids holds our direct children. `bun run dev`/`bun run start` fork grandchildren
# (vite, the ingest server) that a plain `kill $pids` would orphan — those orphans
# are what squat the ports across restarts. So tear down the whole subtree.
pids=()
kill_tree() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}
cleanup() { for pid in "${pids[@]}"; do kill_tree "$pid"; done; }
trap cleanup EXIT INT TERM

# Reboot semantics: before launching, evict anything already holding our ports —
# a previous run whose grandchildren outlived their parent, or a second start.sh.
for port in "${PORTS[@]}"; do
  stale=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$stale" ]; then
    echo "doc.haus: reaping stale process on port $port (pid $stale)"
    kill $stale 2>/dev/null || true
  fi
done
# Give TERM a moment to land, then hard-kill any survivor still on a port.
sleep 1
for port in "${PORTS[@]}"; do
  stale=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  [ -n "$stale" ] && kill -9 $stale 2>/dev/null || true
done

# Seed the demo matter before the stack comes up so it is already selectable on the
# first page load. Runs inline (not backgrounded) via the ingest pipeline's own
# imports — no server needed — and inherits the WORKSPACE_ROOT exported above.
if [ -n "$DEMO" ]; then
  echo "doc.haus: seeding demo matter"
  (cd services/ingest && bun run seed)
fi

WEB_URL="http://localhost:5173"
echo "doc.haus: starting engine, ingest, web (workspace: $WORKSPACE_ROOT)"
echo "doc.haus: web UI will be at $WEB_URL"

# Pin the engine to 4096 so it fails loudly if the port is still taken rather than
# silently drifting to a random port the web app cannot reach.
OPENCODE_CONFIG_DIR="$PWD/dochaus" bun run packages/opencode/src/index.ts serve --port 4096 &
pids+=($!)

(cd services/ingest && bun run start) &
pids+=($!)

(cd apps/web && bun run dev) &
pids+=($!)

# Open the web UI once vite is actually serving (poll the port via bash's /dev/tcp
# so it works without curl). Vite binds IPv6 localhost (::1) by default, so probe
# both stacks. Opt out with NO_OPEN=1; harmless if no opener exists.
if [ -z "${NO_OPEN:-}" ]; then
  (
    for _ in $(seq 1 60); do
      if (exec 3<>/dev/tcp/127.0.0.1/5173) 2>/dev/null || (exec 3<>/dev/tcp/::1/5173) 2>/dev/null; then
        break
      fi
      sleep 0.5
    done
    echo "doc.haus: opening $WEB_URL"
    if command -v open >/dev/null 2>&1; then open "$WEB_URL"
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$WEB_URL" >/dev/null 2>&1
    fi
  ) &
  pids+=($!)
fi

# Block until interrupted (Ctrl-C), then the trap tears every process down. Plain
# `wait` keeps this portable to the bash 3.2 that ships on macOS (`wait -n` is 4.0+).
wait
