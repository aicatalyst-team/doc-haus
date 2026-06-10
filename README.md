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

## What makes it different

doc.haus is built for the two things sensitive legal work actually demands —
**keeping the document in the building, and keeping the lawyer in Word** — neither of
which a hosted SaaS legal-AI tool can give you.

- **Local-first, by design.** A document's text and its embeddings live in a per-matter
  SQLite index (`<matter>/.dochaus/legal.db`) on your own disk, embedded by a local
  MiniLM model. Nothing about a document leaves your infrastructure except the prompt you
  send to the model provider you chose — and that provider can be a local model, so it
  need not leave at all. There is no doc.haus cloud, no vendor data store, no upload to us.
- **Word-native.** doc.haus reads, redlines, and bakes tracked changes back into the
  `.docx` itself (`redline`, `tracked-changes`, `word-integration` tools over an OOXML
  engine), not a lossy re-render. Lawyers live in Word; the output lands there.
- **A real agent engine, not a wrapper.** Forking OpenCode gives multi-agent review (a
  primary agent orchestrating Task subagents), a permission system, skills, the provider
  abstraction, and the streaming server/client stack — and every upstream improvement
  flows in via merge.
- **MIT-licensed.** Embed it in your firm, modify it, ship it, with no copyleft
  obligation.

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
- **`agent/`** — the legal agents: `qa` (cited Q&A), `research` (cited Q&A plus U.S.
  case law), `legal-review` (orchestrator) with its subagents `legal-reviewer`,
  `assumption-challenger`, `summarizer`, plus `extract` (tabular review) and `redliner`
  (tracked-change edits). The review pipeline is agent-driven via the built-in Task tool
  — reviewer → challenger → summarizer — not hardcoded in app logic.
- **`tool/`** — the legal tools, all read-only except the redline tools, which propose
  changes for human review:
  - `search-document` — retrieval + citations. Reads the matter's `legal.db`, embeds the
    query locally, cosine-ranks chunks, returns `{ documentName, section, excerpt, score }[]`.
  - `case-law` — searches U.S. case law via [CourtListener](https://www.courtlistener.com)
    and returns real, citable opinions. The one tool that reaches outside the matter;
    public record only, never the matter's documents.
  - `redline`, `tracked-changes`, `word-integration` — propose and bake tracked changes
    into the `.docx` itself via the OOXML engine.
- **`skill/`** — `contract-risk-checklist`, `clause-library`.
- **`command/review.md`** — runs the `legal-review` orchestrator.

**Tabular review.** Beyond chat, the web app has a review grid (`apps/web`'s
`ReviewGrid` over the ingest service's `grid`): define question-columns once and the
`extract` agent answers them for every document in the matter, so you can bulk-review a
set of contracts side by side instead of one conversation at a time.

## Models and providers

doc.haus is **provider-agnostic** — it inherits OpenCode's model abstraction, so any of
the 75+ providers OpenCode supports (Anthropic, OpenAI, Google, OpenRouter, local
models, …) works by editing `dochaus/opencode.json`. Model choice is a config + UI
concern, not code —
users connect a provider and choose their model in the UI (Settings) on first launch,
then switch per session or agent via OpenCode's inherited multi-model selector. Nothing
is pinned in code — `opencode.json` ships no default model and the agents inherit
whatever you pick.

Out of the box we bundle a ready-to-use **Google Vertex (Gemini)** provider config:
affordable for testing, capable, and fast — connect it in one click if the host has
gcloud ADC. For production use, pick the provider that matches your priorities:

- **Privacy / security** — run an **open-source / self-hosted model** (e.g. via Ollama
  or vLLM) so document content never leaves your infrastructure. Legal work is
  sensitive; this keeps inference local.
- **Accuracy / intelligence** — use **OpenAI** or **Anthropic** frontier models for the
  strongest reasoning on complex contracts.
- **Affordable / fast** — stay on **Vertex (Gemini)**, the shipped default.

The Vertex config reads project and location from env, so nothing is hardcoded:

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
# Start all three processes (engine + ingest + web) with one command
./start.sh
```

No provider env is required to launch. On first run the web app opens **Settings** and
asks you to connect a model provider — a host sign-in (gcloud/AWS), an API key (OpenAI,
Anthropic, Groq...), or a local endpoint (Ollama, vLLM, LM Studio) — and pick your
default model. There is **no hard-coded model default**, since a client may run Vertex,
Anthropic, a local model, or anything else.

To use the bundled Google Vertex provider, sign in with ADC before launching:

```bash
gcloud auth application-default login
export GOOGLE_VERTEX_PROJECT=<your-project>   # only for the Vertex provider
export GOOGLE_VERTEX_LOCATION=global          # Gemini 3.x models are global-only
```

Matters live under `WORKSPACE_ROOT`, which defaults to `./workspace` at the repo root
(gitignored) — set it to an absolute path to keep matters outside the repo.

`start.sh` launches the engine (pointed at `dochaus/`), the ingest service, and the web
app together, and tears them all down if any one exits. To run them by hand instead — in
three terminals:

```bash
OPENCODE_CONFIG_DIR=$PWD/dochaus bun run packages/opencode/src/index.ts serve
cd services/ingest && bun run dev
cd apps/web && bun run dev
```

Then: create a matter → upload a `.docx` contract → ask cited questions in chat → run a
legal review → answers and history persist.

### Try it in two minutes

No document of your own needed — seed a demo matter from a fictional letter of
engagement, ingested through the real pipeline:

```bash
cd services/ingest && bun run seed
```

Open the web app, select **"Aldgate Mills — Engagement (Demo)"**, and ask
*"What is the cap on the firm's liability?"* — you get an answer cited to
`[Letter of Engagement — Aldgate Mills § 9]` with the clause quoted. See `demo/` for
more to try.

## Security and privacy

doc.haus is **self-hosted on infrastructure you control**, and that is the point. There
is **no doc.haus cloud and no multi-tenant service** — so there is no vendor that holds
your clients' privileged documents, no shared database, and no third party to trust with
them. Document text and embeddings never leave your disk; the only thing that goes to the
network is the prompt you send to the model provider you configured, and that provider
can be a local model so it need not leave either. For a profession bound by privilege,
not shipping the data is the strongest posture there is.

The single-tenant model also means doc.haus ships **no built-in user auth** — it assumes
the box it runs on is already yours. The stack is hardened to match:

- **Loopback by default.** Both the engine and the ingest service bind `127.0.0.1`.
  Override the ingest bind with `INGEST_HOST` / `INGEST_PORT` only behind a reverse proxy.
- **CORS is an allowlist, not a wildcard.** The ingest service accepts browser origins
  only from `localhost` / `127.0.0.1`, mirroring the engine's CORS rules.
- **Matter ids are validated** against their generated `[a-z0-9-]` shape before touching
  the filesystem, so a request id can't traverse out of `WORKSPACE_ROOT`.

To put doc.haus in front of a team, add the boundary your firm already trusts: front the
engine and ingest service with an authenticating reverse proxy (SSO/VPN). OpenCode's
optional `OPENCODE_SERVER_PASSWORD` Basic auth covers the engine in the meantime. See
`SECURITY.md` for the full posture and how to report a vulnerability.

## Disclaimer

doc.haus is software, not a law firm. Its output is **not legal advice**, creates no
attorney-client relationship, and like all AI output it can be wrong — models can
misread, omit, or hallucinate. Every answer cites the source passage so it can be
checked; check it. Review anything doc.haus produces with a licensed attorney before
relying on or filing it. Before sending client material through any hosted model
provider, verify that provider's data-use terms (training, retention) yourself — or use
a local model so the question never arises.

## Tests

The ingest service is tested with `bun test`:

```bash
cd services/ingest && bun test
```

## Mergeability

The fork touches a minimal set of upstream-tracked files, and only documentation:
`README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `LICENSE`. The doc-files
keep doc.haus content in a prepended section above the original OpenCode body, so a merge
conflict can only land inside that top section, never in the upstream text below. All
legal *functionality* lives in new paths upstream does not have (`dochaus/`, `services/`,
`apps/`, `demo/`), so `git merge upstream/dev` cannot conflict there at all. See
`FUTURE.md` for the extension seams (custom tools, plugin hooks, vector scale) the MVP
deliberately leaves open.

## Credits

Built on [OpenCode](https://github.com/anomalyco/opencode) by the Anomaly team, MIT
licensed. doc.haus is not affiliated with or endorsed by the OpenCode team.
