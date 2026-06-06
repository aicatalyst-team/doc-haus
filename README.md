# doc.haus

**Open-source legal-agent platform, built as a true fork of [OpenCode](https://github.com/anomalyco/opencode).**

doc.haus retargets OpenCode's agent harness from code/git onto **legal documents**.
The concepts map almost 1:1, so we inherit the engine — sessions, agents,
subagents, tools, permissions, skills, the provider abstraction, and the
server/client + SSE stack — and add a thin legal layer on top.

| Legal concept       | OpenCode primitive          |
| ------------------- | --------------------------- |
| Matter              | project (a directory)       |
| Document            | a file in the matter dir    |
| Conversation        | session                     |
| Legal agent         | agent                       |
| Multi-agent review  | primary agent + Task subagents |
| Retrieval / citation | a custom tool              |

Matter and Document are labels in the UI and our config; the core primitives
(`project`, `file`, `session`) are never renamed. We fork rather than reimplement
so we keep pulling upstream innovation via `git merge upstream/dev`.

## Architecture

Everything legal is **additive** — it lives outside upstream packages so merges
stay clean. Three processes at runtime:

1. **`opencode serve`** — the unmodified OpenCode engine. Scopes every session
   and tool to a matter via the `x-opencode-directory` header.
2. **`services/ingest/`** — standalone Bun + Hono service. Creates matters and
   turns uploaded DOCX into embeddings: `mammoth` extract → sectionize →
   local MiniLM (`@xenova/transformers`, all-MiniLM-L6-v2, 384-dim) → per-matter
   `<matter>/.dochaus/legal.db` (`bun:sqlite`). Exists because OpenCode has no
   upload endpoint and plugins cannot add HTTP routes.
3. **`apps/web/`** — React + Vite frontend on the OpenCode SDK + the ingest API.

The legal config layer lives in **`dochaus/`** and is loaded by pointing the
server at it with `OPENCODE_CONFIG_DIR=<repo>/dochaus`, so the upstream
`.opencode/` dev config is never touched. It contains:

- **`opencode.json`** — Google Vertex (Gemini) provider, models, permissions.
- **`agent/`** — five legal agents: `qa` (cited Q&A), `legal-review`
  (orchestrator), and its subagents `legal-reviewer`, `assumption-challenger`,
  `summarizer`. The review pipeline is agent-driven via the built-in Task tool —
  reviewer → challenger → summarizer — not hardcoded in app logic.
- **`tool/search-document.ts`** — retrieval + citations. Reads the matter's
  `legal.db`, embeds the query locally, cosine-ranks chunks, returns
  `{ documentName, section, excerpt, score }[]`. Read-only.
- **`skill/`** — `contract-risk-checklist`, `clause-library`.
- **`command/review.md`** — runs the `legal-review` orchestrator.

## Quick start

Prerequisites: [Bun](https://bun.sh), a Google Cloud project with Vertex AI
enabled, and ADC auth.

```bash
bun install

# Auth — Vertex uses Application Default Credentials, no API keys.
gcloud auth application-default login
export GOOGLE_VERTEX_PROJECT=<your-project>
export GOOGLE_VERTEX_LOCATION=global   # Gemini 3.x models are global-only

# Where matters live (independent of this repo)
export WORKSPACE_ROOT=<path-to-matters>

# 1. The engine, pointed at the legal config layer
OPENCODE_CONFIG_DIR=$PWD/dochaus bun run packages/opencode/src/index.ts serve

# 2. The ingest service (separate terminal)
cd services/ingest && bun run src/server.ts

# 3. The web app (separate terminal)
cd apps/web && bun run dev
```

Then: create a matter → upload a `.docx` contract → ask cited questions in chat →
run a legal review → answers and history persist.

## Models

Configured in `dochaus/opencode.json` and per-agent frontmatter as **defaults
only** — users pick provider/model per session or agent in the UI (OpenCode's
multi-model selector is inherited). The provider reads project and location from
env (`{env:GOOGLE_VERTEX_PROJECT}` / `{env:GOOGLE_VERTEX_LOCATION}`); nothing is
hardcoded.

## Mergeability

The fork touches a minimal set of upstream-tracked files (this README, `AGENTS.md`).
All legal functionality lives in new paths upstream does not have (`dochaus/`,
`services/`, `apps/`), so `git merge upstream/dev` cannot conflict outside those
few edge files. See `FUTURE.md` for the extension seams (custom tools, plugin
hooks, vector scale) the MVP deliberately leaves open.

## Credits

Built on [OpenCode](https://github.com/anomalyco/opencode). doc.haus is not
affiliated with or endorsed by the OpenCode team.
