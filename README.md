<h1 align="center">doc.haus</h1>

<p align="center">The open-source AI legal-document agent.</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode"><img alt="Built on OpenCode" src="https://img.shields.io/badge/built%20on-OpenCode-f59e0b?style=flat-square" /></a>
  <img alt="Runtime" src="https://img.shields.io/badge/runtime-Bun-000000?style=flat-square" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white" />
</p>

---

**doc.haus is a true fork of [OpenCode](https://github.com/anomalyco/opencode)** that
retargets its agent harness from code/git onto **legal documents**. The concepts map
almost 1:1, so we inherit the whole engine — sessions, agents, subagents, tools,
permissions, skills, the provider abstraction, and the server/client + SSE stack — and
add a thin legal layer on top.

| Legal concept        | OpenCode primitive             |
| -------------------- | ------------------------------ |
| Matter               | project (a directory)          |
| Document             | a file in the matter dir       |
| Conversation         | session                        |
| Legal agent          | agent                          |
| Multi-agent review   | primary agent + Task subagents |
| Retrieval / citation | a custom tool                  |

Matter and Document are labels in the UI and our config; the core primitives
(`project`, `file`, `session`) are never renamed. We fork rather than reimplement so we
keep pulling upstream innovation via `git merge upstream/dev`.

## Architecture

Everything legal is **additive** — it lives outside upstream packages so merges stay
clean. Three processes at runtime:

1. **`opencode serve`** — the unmodified OpenCode engine. Scopes every session and tool
   to a matter via the `x-opencode-directory` header.
2. **`services/ingest/`** — standalone Bun + Hono service. Creates matters and turns
   uploaded DOCX into embeddings: `mammoth` extract → sectionize → local MiniLM
   (`@xenova/transformers`, all-MiniLM-L6-v2, 384-dim) → per-matter
   `<matter>/.dochaus/legal.db` (`bun:sqlite`). Exists because OpenCode has no upload
   endpoint and plugins cannot add HTTP routes.
3. **`apps/web/`** — React + Vite frontend on the OpenCode SDK + the ingest API.

The legal config layer lives in **`dochaus/`** and is loaded by pointing the server at
it with `OPENCODE_CONFIG_DIR=<repo>/dochaus`, so the upstream `.opencode/` dev config is
never touched. It contains:

- **`opencode.json`** — provider, models, and legal-safe permissions.
- **`agent/`** — five legal agents: `qa` (cited Q&A), `legal-review` (orchestrator), and
  its subagents `legal-reviewer`, `assumption-challenger`, `summarizer`. The review
  pipeline is agent-driven via the built-in Task tool — reviewer → challenger →
  summarizer — not hardcoded in app logic.
- **`tool/search-document.ts`** — retrieval + citations. Reads the matter's `legal.db`,
  embeds the query locally, cosine-ranks chunks, returns
  `{ documentName, section, excerpt, score }[]`. Read-only.
- **`skill/`** — `contract-risk-checklist`, `clause-library`.
- **`command/review.md`** — runs the `legal-review` orchestrator.

## Models and providers

doc.haus is **provider-agnostic** — it inherits OpenCode's model abstraction, so any of
the 75+ providers OpenCode supports (Anthropic, OpenAI, Google, OpenRouter, local
models, …) works by editing `dochaus/opencode.json`. Model choice is a config + UI
concern, not code: `opencode.json` and per-agent frontmatter set **defaults only**, and
users switch provider/model per session or agent in the UI via OpenCode's inherited
multi-model selector.

Out of the box we ship a **Google Vertex (Gemini)** config because that's what we test
against. It reads project and location from env, so nothing is hardcoded:

```jsonc
// dochaus/opencode.json (excerpt)
"google-vertex": {
  "options": {
    "project": "{env:GOOGLE_VERTEX_PROJECT}",
    "location": "{env:GOOGLE_VERTEX_LOCATION}"
  }
}
```

To use a different provider, swap the provider block and the `model` / `small_model`
defaults — see the [OpenCode provider docs](https://opencode.ai/docs/providers).

## Quick start

Prerequisites: [Bun](https://bun.sh), and credentials for whichever model provider you
configure (the shipped default is Google Vertex via ADC — no API keys).

```bash
bun install

# Provider auth — example for the shipped Vertex default.
# For a different provider, set its key per the OpenCode provider docs instead.
gcloud auth application-default login
export GOOGLE_VERTEX_PROJECT=<your-project>
export GOOGLE_VERTEX_LOCATION=global   # Gemini 3.x models are global-only

# Where matters live (independent of this repo)
export WORKSPACE_ROOT=<path-to-matters>

# 1. The engine, pointed at the legal config layer
OPENCODE_CONFIG_DIR=$PWD/dochaus bun run packages/opencode/src/index.ts serve

# 2. The ingest service (separate terminal)
cd services/ingest && bun run dev

# 3. The web app (separate terminal)
cd apps/web && bun run dev
```

Then: create a matter → upload a `.docx` contract → ask cited questions in chat → run a
legal review → answers and history persist.

## Mergeability

The fork touches a minimal set of upstream-tracked files (this README, `AGENTS.md`). All
legal functionality lives in new paths upstream does not have (`dochaus/`, `services/`,
`apps/`), so `git merge upstream/dev` cannot conflict outside those few edge files. See
`FUTURE.md` for the extension seams (custom tools, plugin hooks, vector scale) the MVP
deliberately leaves open.

## Credits

Built on [OpenCode](https://github.com/anomalyco/opencode) by the Anomaly team, MIT
licensed. doc.haus is not affiliated with or endorsed by the OpenCode team.
