#!/usr/bin/env bun
// doc.haus prompt-asset eval harness (asset review 2026-06-11, finding: every
// prompt edit ships blind). Run from the dochaus package directory:
//
//   bun eval/run.ts            # offline checks only (no model calls)
//   bun eval/run.ts --live     # also run model-backed checks (requires wiring
//                              # the MODEL SEAM below — it throws until then)
//
// Offline checks need no model and run fully:
//   - fixture schema validation for all four suites
//   - router: every candidate and expected agent resolves to a real agent file
//   - extract: every expected quote anchors verbatim in the fixture document,
//     within the cite tool's 10-600 char bounds
//   - citations: every case is executed against the REAL findQuote from
//     lib/extract.ts — the same matcher the cite tool and the legal plugin's
//     verification ladder use — and must verify/reject as the fixture says
// Model-backed checks (router classification accuracy, extract answer quality,
// jurisdiction rubric grading) are reported as TODO until the seam is wired.
// Nothing here fabricates a model result.

import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { findQuote } from "../lib/extract"

const evalDir = import.meta.dir
const fixturesDir = path.join(evalDir, "fixtures")
const agentDir = path.join(evalDir, "..", "agent")
const jurisdictionDir = path.join(evalDir, "..", "jurisdiction")
const live = process.argv.includes("--live")

type CaseResult = { id: string; ok: boolean; detail: string }

type RouterCase = {
  id: string
  candidates: string[]
  history: string[]
  message: string
  expected: string
  rule: string
}
type ExtractCase = { id: string; question: string; expectedAnswer: string; expectedQuote: string }
type CitationCase = { id: string; kind: string; claim: string; quote: string; expect: "verified" | "rejected" }
type JurisdictionProbe = { id: string; agent: string; input: string }
type JurisdictionScenario = {
  id: string
  matterName: string
  matterJurisdictions: string[]
  matterDescription: string
  probes: JurisdictionProbe[]
}

// Agent roster, parsed from the live prompt files so fixtures can never drift
// from the agents that actually exist. description comes from the frontmatter —
// it is what the router sees for each candidate.
const agents = new Map(
  await Promise.all(
    readdirSync(agentDir)
      .filter((f) => f.endsWith(".md"))
      .map(async (f) => {
        const text = await Bun.file(path.join(agentDir, f)).text()
        const description = text.match(/^description:\s*(.+)$/m)?.[1].trim() ?? ""
        return [f.replace(/\.md$/, ""), description] as const
      }),
  ),
)

const results: { suite: string; cases: CaseResult[]; todo?: string }[] = []

// ---------------------------------------------------------------------------
// Suite: router — offline = schema + roster checks; live = classification.
// ---------------------------------------------------------------------------
const routerFile = (await Bun.file(path.join(fixturesDir, "router", "cases.json")).json()) as { cases: RouterCase[] }
const routerOffline = routerFile.cases.flatMap((c) => {
  const problems = [
    !c.id && "missing id",
    !c.message && "missing message",
    !c.rule && "missing rule",
    !Array.isArray(c.candidates) || c.candidates.length < 2 ? "needs at least 2 candidates" : false,
    !Array.isArray(c.history) && "history must be an array",
    !c.candidates.includes(c.expected) && `expected "${c.expected}" is not among the candidates`,
    ...c.candidates.map((name) => !agents.has(name) && `candidate "${name}" has no agent file in dochaus/agent/`),
  ].filter((p): p is string => Boolean(p))
  if (!problems.length) return [{ id: c.id, ok: true, detail: c.rule }]
  return problems.map((p) => ({ id: c.id ?? "(no id)", ok: false, detail: p }))
})
const routerDupes = routerFile.cases
  .map((c) => c.id)
  .filter((id, i, all) => all.indexOf(id) !== i)
  .map((id) => ({ id, ok: false, detail: "duplicate case id" }))
results.push({
  suite: "router (offline: schema + agent roster)",
  cases: [...routerOffline, ...routerDupes],
})

// ---------------------------------------------------------------------------
// Suite: extract — offline = every expected quote must anchor verbatim in the
// fixture document via the real findQuote, and fit the cite tool's bounds.
// ---------------------------------------------------------------------------
const extractFile = (await Bun.file(path.join(fixturesDir, "extract", "cases.json")).json()) as {
  document: string
  documentName: string
  cases: ExtractCase[]
}
const extractText = await Bun.file(path.join(fixturesDir, "extract", extractFile.document)).text()
const extractOffline = extractFile.cases.map((c) => {
  if (!c.id || !c.question || !c.expectedAnswer || !c.expectedQuote)
    return { id: c.id ?? "(no id)", ok: false, detail: "missing id/question/expectedAnswer/expectedQuote" }
  if (c.expectedQuote.length < 10 || c.expectedQuote.length > 600)
    return { id: c.id, ok: false, detail: `expectedQuote is ${c.expectedQuote.length} chars; cite tool accepts 10-600` }
  if (!findQuote(extractText, c.expectedQuote))
    return { id: c.id, ok: false, detail: `expectedQuote does not anchor in ${extractFile.document}` }
  return { id: c.id, ok: true, detail: "quote anchors verbatim" }
})
results.push({ suite: "extract (offline: quotes anchor in fixture document)", cases: extractOffline })

// ---------------------------------------------------------------------------
// Suite: citations — fully executable offline. Each case runs through the real
// findQuote; the fixture says whether the anchor must verify or reject.
// ---------------------------------------------------------------------------
const citationsFile = (await Bun.file(path.join(fixturesDir, "citations", "cases.json")).json()) as {
  document: string
  cases: CitationCase[]
}
const citationsText = await Bun.file(path.join(fixturesDir, "citations", citationsFile.document)).text()
const citationsOffline = citationsFile.cases.map((c) => {
  if (!c.id || !c.quote || !c.claim || !["verified", "rejected"].includes(c.expect))
    return { id: c.id ?? "(no id)", ok: false, detail: "missing id/claim/quote or bad expect value" }
  const actual = findQuote(citationsText, c.quote) ? "verified" : "rejected"
  if (actual === c.expect) return { id: c.id, ok: true, detail: `${c.kind}: ${actual} as expected` }
  return { id: c.id, ok: false, detail: `${c.kind}: expected ${c.expect}, findQuote ${actual} it` }
})
results.push({ suite: "citations (offline: executed against lib/extract findQuote)", cases: citationsOffline })

// ---------------------------------------------------------------------------
// Suite: jurisdiction — offline = schema + pack checks; grading is rubric-based.
// ---------------------------------------------------------------------------
const jurisdictionFile = (await Bun.file(path.join(fixturesDir, "jurisdiction", "scenario.json")).json()) as {
  scenario: JurisdictionScenario
}
const scenario = jurisdictionFile.scenario
const rubricPath = path.join(fixturesDir, "jurisdiction", "rubric.md")
const rubricText = existsSync(rubricPath) ? await Bun.file(rubricPath).text() : ""
const jurisdictionOffline = [
  {
    id: `${scenario.id}/packs`,
    ok: scenario.matterJurisdictions.every((code) =>
      existsSync(path.join(jurisdictionDir, code, "profile.json")),
    ),
    detail: `matter jurisdictions [${scenario.matterJurisdictions.join(", ")}] resolve to packs in dochaus/jurisdiction/`,
  },
  {
    id: `${scenario.id}/prompt`,
    ok: scenario.matterJurisdictions.every((code) => existsSync(path.join(jurisdictionDir, code, "prompt.md"))),
    detail: "every pack has a prompt.md (an empty pack prompt would void the test)",
  },
  {
    id: `${scenario.id}/rubric`,
    ok: rubricText.includes("MUST NOT"),
    detail: "rubric.md exists and carries MUST NOT criteria",
  },
  ...scenario.probes.map((p) => ({
    id: p.id,
    ok: Boolean(p.id && p.input) && agents.has(p.agent),
    detail: `probe targets agent "${p.agent}"`,
  })),
]
results.push({
  suite: "jurisdiction (offline: scenario schema + pack existence)",
  cases: jurisdictionOffline,
})

// =============================================================================
// MODEL SEAM — TODO: not wired. Everything below this line is the only part of
// the harness that talks to a model, and it deliberately throws until wired so
// no result can be faked.
//
// To wire it, do ONE of:
//
//  a) Engine-backed (preferred — exercises the real prompts): start the engine
//     exactly as the platform does (`OPENCODE_CONFIG_DIR=<repo>/dochaus
//     opencode serve`), create a throwaway session via the SDK, and prompt it
//     with `body: { agent: request.agent, parts: [{ type: "text", text:
//     request.prompt }] }` — mirror routeAgent/routeOnce in
//     apps/web/src/api/opencode.ts, including the timeout and session cleanup.
//     This runs the real agent frontmatter (model pin, temperature, tools).
//
//  b) Direct Vertex (faster, but bypasses agent frontmatter): call Gemini on
//     Vertex with the same env the platform uses — ADC via `gcloud auth
//     application-default login`, GOOGLE_VERTEX_PROJECT, and
//     GOOGLE_VERTEX_LOCATION — passing the agent's prompt body (read from
//     dochaus/agent/<agent>.md below the frontmatter) as the system prompt.
//
// Grading once wired: router replies are graded deterministically below (exact
// or embedded candidate-name match, mirroring routeOnce). extract and
// jurisdiction need a grader — extract against expectedAnswer/expectedQuote,
// jurisdiction against fixtures/jurisdiction/rubric.md (LLM-judge or human);
// see eval/README.md.
// =============================================================================
type ModelRequest = { suite: string; agent: string; prompt: string }
async function runModel(request: ModelRequest): Promise<string> {
  throw new Error(
    `runModel is not wired (requested ${request.suite}/${request.agent}). ` +
      "See the MODEL SEAM comment in eval/run.ts for wiring instructions.",
  )
}

// Live router classification: build the exact prompt shape routeAgent sends
// (apps/web/src/api/opencode.ts routePrompt) and grade like routeOnce does.
async function liveRouterSuite(): Promise<CaseResult[]> {
  const out: CaseResult[] = []
  for (const c of routerFile.cases) {
    const prompt = [
      "<candidates>",
      c.candidates.map((name) => `- ${name}: ${agents.get(name) ?? ""}`).join("\n"),
      "</candidates>",
      "<history>",
      c.history.length ? c.history.map((h) => `- ${h}`).join("\n") : "(none)",
      "</history>",
      "<message>",
      c.message,
      "</message>",
    ].join("\n")
    const reply = (await runModel({ suite: "router", agent: "router", prompt })).trim()
    const picked =
      c.candidates.find((n) => reply === n) ??
      c.candidates.find((n) => reply.toLowerCase().includes(n.toLowerCase())) ??
      "(off-list)"
    out.push({
      id: c.id,
      ok: picked === c.expected,
      detail: picked === c.expected ? `routed to ${picked}` : `expected ${c.expected}, got ${picked}: "${reply}"`,
    })
  }
  return out
}

if (live) {
  results.push({ suite: "router (live: classification)", cases: await liveRouterSuite() })
} else {
  results.push({
    suite: "router (live: classification)",
    cases: [],
    todo: "SKIPPED — run with --live after wiring the MODEL SEAM in eval/run.ts",
  })
  results.push({
    suite: "extract (live: answer quality)",
    cases: [],
    todo: "SKIPPED — needs the model seam plus a grader against expectedAnswer/expectedQuote (see README)",
  })
  results.push({
    suite: "jurisdiction (live: rubric grading)",
    cases: [],
    todo: "SKIPPED — needs the model seam plus rubric.md grading (LLM-judge or human; see README)",
  })
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const failures = results.flatMap((r) => r.cases.filter((c) => !c.ok))
console.log("doc.haus prompt-asset eval report")
console.log("=================================")
for (const r of results) {
  const failed = r.cases.filter((c) => !c.ok)
  const header = r.todo ?? `${r.cases.length - failed.length}/${r.cases.length} passed`
  console.log(`\n${r.suite}: ${header}`)
  for (const c of failed) console.log(`  FAIL ${c.id} — ${c.detail}`)
}
console.log(`\n${failures.length ? `${failures.length} failure(s).` : "All executed checks passed."}`)
process.exit(failures.length ? 1 : 0)
