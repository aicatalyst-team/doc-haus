# doc.haus prompt-asset evals

Regression harness for the prompt assets under `dochaus/` (agents, skills,
playbooks, jurisdiction packs). Before this existed, every prompt edit shipped
blind (asset review 2026-06-11). The harness splits cleanly into two layers:

- **Offline checks** — run on every invocation, need no model, no network, no
  credentials. They validate fixture schemas against the live agent roster and
  execute the citation cases against the *real* quote matcher (`findQuote` in
  `dochaus/lib/extract.ts` — the same code path the `cite` tool and the legal
  plugin's verification ladder use), so they double as a regression test for the
  anchoring logic itself.
- **Model-backed checks** — router classification accuracy, extract answer
  quality, and jurisdiction-discipline grading. These sit behind one stub
  (`runModel` in `run.ts`, marked `MODEL SEAM`) that throws until wired, so the
  harness can never fabricate a model result.

## Running

From the `dochaus/` package directory (dependencies live there):

```
bun eval/run.ts            # offline checks; exit 1 on any failure
bun eval/run.ts --live     # also run model-backed checks (throws until the
                           # MODEL SEAM is wired)
```

## Suites

| Suite | Fixtures | Offline | Model-backed |
|---|---|---|---|
| router | `fixtures/router/cases.json` | candidates/expected resolve to real files in `dochaus/agent/`; expected is among candidates | send each case through the router agent and require the expected candidate name back |
| extract | `fixtures/extract/` (synthetic NDA + Q&A) | every `expectedQuote` anchors verbatim in the document, within the cite tool's 10-600 char bounds | ask the extract agent each question, grade against `expectedAnswer`/`expectedQuote` |
| citations | `fixtures/citations/cases.json` | **fully executed offline**: every case runs through `findQuote` and must verify/reject as declared | end-to-end: confirm the agent refuses to present a rejected quote |
| jurisdiction | `fixtures/jurisdiction/` (scenario + rubric) | scenario schema; jurisdiction packs exist and carry a `prompt.md` | run the probes on an EW matter, grade against `rubric.md` |

The synthetic NDA (`fixtures/extract/nda-meridian-harborlight.txt`) was written
for this repo — fictional parties, market-standard terms — so there are no
licensing constraints on it.

## Wiring the model seam

`runModel` in `run.ts` is the only place the harness talks to a model. Two
honest ways to wire it (full instructions in the `MODEL SEAM` comment):

1. **Engine-backed (preferred).** Start the engine exactly as the platform does
   (`OPENCODE_CONFIG_DIR=<repo>/dochaus opencode serve`), then prompt a
   throwaway session with `agent: request.agent` — mirroring
   `routeAgent`/`routeOnce` in `apps/web/src/api/opencode.ts`, including the
   timeout and the session delete in a `finally`. This exercises the real agent
   frontmatter: model pin, temperature, tool grants.
2. **Direct Vertex.** Call Gemini on Vertex with the same environment the
   platform uses — ADC (`gcloud auth application-default login`),
   `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION` — passing the agent's
   prompt body as the system prompt. Faster, but bypasses frontmatter, so
   prefer (1) for anything gating a release.

Grading once wired: router is graded deterministically (exact or embedded
candidate-name match, mirroring `routeOnce`); extract needs a comparison
against `expectedAnswer` facts (LLM-judge or string rubric); jurisdiction is
graded against `fixtures/jurisdiction/rubric.md` (LLM-judge or human — there is
no deterministic oracle for jurisdiction discipline).

## Adding fixtures

- **Router**: append to `fixtures/router/cases.json`. `candidates` must be real
  agent ids (file names in `dochaus/agent/` without `.md`) — descriptions are
  resolved from the agent frontmatter at runtime, so fixtures never go stale.
  The candidate set must mirror `CHAT_ASSISTANTS` in `apps/web/src/agents.ts` —
  that array is exactly what production Auto routing offers the router. Cite the
  `router.md` rule that decides the case in `rule`. When an agent is added to or
  removed from `CHAT_ASSISTANTS`, update every fixture's candidate set here in
  the same commit.
- **Extract**: add a Q&A pair to `fixtures/extract/cases.json`. `expectedQuote`
  must be copied byte-for-byte from the fixture document (the offline check
  enforces this — run `bun eval/run.ts` before committing). Keep answers
  cell-sized: the extract agent fills one spreadsheet cell.
- **Citations**: add a case to `fixtures/citations/cases.json` with `expect:
  "verified"` or `"rejected"` and a `why`. Useful `kind`s to keep covered:
  paraphrase, synonym swap, ellipsis injection, altered numbers, dropped
  punctuation, re-casing, plausible boilerplate the document lacks. Remember
  the designed tolerance: whitespace runs are normalized, everything else must
  match exactly.
- **Jurisdiction**: add probes to `fixtures/jurisdiction/scenario.json` (or a
  new scenario file plus rubric for another non-US pack — DE, FR, SG, AU are
  the next candidates once their `prompt.md`s exist). Keep rubric criteria
  pass/fail and conservative: test that the model qualifies and abstains
  correctly, not that it recites specific law.

## Harvey LAB benchmark

Two runners drive the [Harvey LAB](https://github.com/harveyai/harvey-labs)
benchmark against local doc.haus. Both need the stack running (`opencode serve`
on :4096, `services/ingest` on :4500) and run from the `dochaus/` package
directory. The Vertex judge project comes from `--project` or
`GOOGLE_CLOUD_PROJECT` / `GOOGLE_VERTEX_PROJECT` — nothing is hardcoded.

- `run-harvey-task.ts` — one task: creates a matter, uploads the task's
  `documents/`, prompts the drafter with the `task.json` instructions
  (auto-approving permission asks), stages produced `.docx` into the
  harvey-labs results tree, and prints the scoring command.
- `run-harvey-suite.ts` — the whole benchmark (1251 tasks, including
  `scenario-NN` sub-tasks): spawns the single-task runner once per task,
  strictly serially. Quota safety is the point: `--cooldown` seconds between
  tasks (default 20), per-task `--task-timeout` minutes (default 25, kills the
  child and moves on), and a 429/RESOURCE_EXHAUSTED retry ladder (wait 5 min,
  retry; wait 10 min, retry; then mark failed and continue).

```
bun eval/run-harvey-suite.ts --tasks-root ~/path/to/harvey-labs/tasks \
  [run-id] [--area immigration,tax] [--task substring] [--limit 10] [--dry-run] \
  [--jurisdiction US-CA,US-NY] [--project <gcp-project>] [--location <loc>] \
  [--judge-model <model>]
```

`--dry-run` prints the selected task list and exits without touching anything.
Outputs land at `results/<run-id>/<area>/<slug>/output` and a crash-safe
`results/<run-id>/suite-manifest.json` records every task's status; rerunning
with the same run-id skips tasks whose output dir is already non-empty, so an
interrupted suite resumes. Scoring is a separate step (the suite prints the
`evaluation.run_eval` command, pinned to `--parallel 1`) — wait a few minutes
after generation before judging so the Vertex quota recovers.

## Future: LegalBench `contract_nli_*` as an NDA-playbook regression suite

[LegalBench](https://github.com/HazyResearch/legalbench) includes the
`contract_nli_*` task family (built on the ContractNLI dataset): each task asks
whether a real NDA clause entails a fixed hypothesis — yes/no entailment over
exactly the clause families our NDA playbook
(`dochaus/playbooks/playbook-nda/SKILL.md`) takes positions on. That makes it a
ready-made regression suite for the playbook-reviewer pipeline: if the model
cannot classify a clause correctly in isolation, it cannot review it against a
playbook position.

Representative mapping (task → playbook section):

| LegalBench task | playbook-nda section |
|---|---|
| `contract_nli_survival_of_obligations` | Confidentiality term |
| `contract_nli_return_of_confidential_information` | Return or destruction |
| `contract_nli_permissible_copy` | Return or destruction (archival-copy carve-out) |
| `contract_nli_notice_on_compelled_disclosure` | Permitted disclosures |
| `contract_nli_sharing_with_employees` / `contract_nli_sharing_with_third-parties` | Permitted disclosures |
| `contract_nli_no_licensing` | Definition of confidential information / Residual knowledge |
| `contract_nli_inclusion_of_verbally_conveyed_information` | Definition of confidential information |
| `contract_nli_permissible_development_of_similar_information` | Exclusions / Residual knowledge |
| `contract_nli_no_solicitation` | Non-solicitation |
| `contract_nli_explicit_identification` | Definition of confidential information |

Documented hook only — the dataset is **not** vendored here. To activate:
download the task TSVs from the LegalBench repo into a git-ignored
`eval/fixtures/legalbench/` directory, add a loader that turns each row into a
`{ clause, hypothesis, expected }` case, and run them through the model seam
with the playbook loaded. LegalBench's per-task base prompts plus
model-specific prompt variants fit the Gemini-on-Vertex stack as-is. Check the
individual task licenses in the LegalBench repo before redistributing any of
its data with doc.haus.
