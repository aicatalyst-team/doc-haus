# Fresh-clone sandbox for doc.haus.
#
# Reproduces what a brand-new user gets: only the files git actually tracks,
# nothing from the working tree. run.sh feeds `git archive HEAD` (tracked
# files, no node_modules, no untracked manifests) in as fresh.tar, so this
# image starts from exactly what `git clone` would hand a stranger.
#
# The verify.sh RUN runs the dochaus slice of start.sh's install loop
# (`bun install --frozen-lockfile`) and asserts the config-layer deps resolve
# and the docxodus patch applies. If the manifest is not tracked (issue #42),
# the frozen install has no lockfile and the build fails here.
FROM oven/bun:1.3.14

WORKDIR /app

# Tracked-files-only tarball produced by run.sh — a faithful fresh clone.
COPY fresh.tar /tmp/fresh.tar
RUN tar -xf /tmp/fresh.tar -C /app && rm /tmp/fresh.tar

COPY verify.sh /usr/local/bin/verify.sh
RUN bash /usr/local/bin/verify.sh
