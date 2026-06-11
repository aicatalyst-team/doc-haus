#!/usr/bin/env bash
# Fresh-clone test: build an image from only the files git tracks and run the
# dochaus install loop inside it. Proves a stranger who clones the repo and
# runs ./start.sh gets a working config layer (regression guard for #42).
#
#   ./sandbox/run.sh            # test current HEAD
#   REF=<commit> ./sandbox/run.sh   # test any ref
set -euo pipefail
cd "$(dirname "$0")/.."

REF="${REF:-HEAD}"
echo "doc.haus sandbox: archiving tracked files at $REF"

# git archive emits ONLY tracked content — no working-tree node_modules, no
# untracked manifests — so the container starts from a true fresh clone.
git archive --format=tar "$REF" -o sandbox/fresh.tar
trap 'rm -f sandbox/fresh.tar' EXIT

docker build -f sandbox/Dockerfile -t dochaus-freshclone sandbox/

echo
echo "doc.haus sandbox: PASS — fresh clone of $REF installs cleanly."
