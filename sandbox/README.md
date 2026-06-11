# Fresh-clone sandbox

Verifies that someone who `git clone`s doc.haus and runs `./start.sh` gets a
working install — with no leftover working-tree state masking missing files.

```sh
./sandbox/run.sh              # test current HEAD
REF=<commit> ./sandbox/run.sh # test any ref
```

`run.sh` feeds `git archive <ref>` (tracked files only) into a clean
`oven/bun` container, then runs the dochaus slice of `start.sh`'s
`bun install --frozen-lockfile` loop and asserts the config-layer
dependencies (`@xenova/transformers`, `docxodus` + its patch, `mammoth`,
`unpdf`) resolve. The build fails if anything is missing.

Scope: the dochaus config layer, the part issue #42 broke. The root, ingest,
and web installs are heavier and the live stack needs a provider credential
(Google Vertex ADC), so they are out of scope here — this is a dependency
regression guard, not a full end-to-end boot.
