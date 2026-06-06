# doc.haus — Future Seams

This file documents the extension points that the MVP deliberately leaves as
seams. None of these are implemented; each note records *where* the hook lives
and *what already exists* to make it cheap to add later. The MVP rule still
holds: build additively, keep upstream packages untouched.

## Custom tools (drop-in files under `dochaus/tool/`)

The tool loader globs `{tool,tools}/*.{js,ts}` over every config directory
(including `OPENCODE_CONFIG_DIR=dochaus`); a default export becomes a tool whose
id is the filename. Adding a tool is one file — no core edit, no registration.

- **word-integration** — read/write `.docx` in place (open in Word, round-trip
  edits). The ingest service already writes the canonical `.docx` into the matter
  dir, so a tool can operate on that same file.
- **tracked-changes** — emit Word tracked-changes (`w:ins`/`w:del`) so a redline
  is reviewable in Word. Pairs with word-integration.
- **redline** — propose clause rewrites as a structured diff against the source
  span. The citation objects already carry `doc_path` + `char_start`/`char_end`,
  so a redline can target an exact source range.

## Skills (drop-in dirs under `dochaus/skill/<name>/SKILL.md`)

Skills are markdown knowledge packs referenced by agents by name. Two already
ship (`contract-risk-checklist`, `clause-library`). Future slots:

- **precedent-search** — a skill describing how to find and compare comparable
  clauses/matters. Would lean on a future cross-matter index (see Vector scale).
- **privilege-review** — a checklist for attorney-client privilege / work-product
  flags before anything leaves the workspace.

## Plugin hooks (`dochaus/plugin/legal.ts` — create only when first used)

No plugin ships in the MVP: the search-document tool opens `legal.db` directly,
ingestion lives in `services/ingest`, and Vertex auth is config-driven. The
plugin file is reserved as the seam for:

- **`tool.execute.after`** — citation-verification. After `search-document` (or a
  future answer-with-citations tool) runs, validate each citation's `doc_path` +
  `char_start`/`char_end` against the source file and reject/flag hallucinated
  spans. The citation payload is already shaped for this (stable path + offsets).
- **`permission.ask`** — redlining / edit gating. Route edit-class tools through a
  human approval step before they touch a document.

## Retrieval at scale

The MVP ranks chunks with a JS cosine loop over a BLOB `embedding` column in each
matter's `legal.db`. Fine for a single contract; not for large corpora. Future:
`sqlite-vec` (or a real ANN index) behind the same `search-document` interface —
the tool's return shape (`{ documentName, section, excerpt, score }[]`) stays
constant, so the UI and agents don't change.

Per-matter DBs (`<matterDir>/.dochaus/legal.db`) keep matters isolated for
confidentiality. A future cross-matter precedent index would be a separate,
explicitly-scoped store — not a widening of the per-matter DB.

## Confidentiality / data residency

Embeddings are computed locally (MiniLM), but inference is remote (Vertex sends
document content to Google). For privileged work this is a real consideration.
Seam: the provider is pure `opencode.json` config, so swapping in an on-prem /
self-hosted model is a config change, not a code change.

## Single-user → multi-tenant

OpenCode is local, single-user. Legal SaaS concerns (auth, tenant isolation,
audit trail) are out of scope. The matter-per-directory model and per-matter DB
are the natural tenant boundary when that work begins; the `x-opencode-directory`
header already scopes every session and tool to one matter.

## Mergeability

The fork touches exactly one upstream-tracked file (`AGENTS.md`, a prepended
section). All legal functionality lives in new paths upstream does not have
(`dochaus/`, `services/`, `apps/`), so `git merge upstream/dev` cannot conflict
outside `AGENTS.md`. Keep it that way: default to building in those paths, and
isolate any unavoidable core edit in one clearly-marked commit.
