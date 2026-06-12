#!/usr/bin/env bun
// Headless doc.haus runner for one Harvey LAB benchmark task
// (https://github.com/harveyai/harvey-labs). Creates a matter via the ingest
// service, uploads the task's documents/, prompts the drafter agent with the
// task.json instructions verbatim (auto-approving permission asks), then
// stages every .docx the agent produced into the harvey-labs results tree as
// results/<run-id>/<task-slug>/output/ and prints the eval command to score it.
//
// Requires the stack running: `opencode serve` on :4096 and services/ingest on
// :4500. Run from the dochaus package directory (dependencies live there):
//
//   bun eval/run-harvey-task.ts \
//     ~/path/to/harvey-labs/tasks/employment-labor/offer-letter-to-employment-agreement \
//     my-run-id --jurisdiction US-CA --project my-gcp-project
//
// task.json carries no jurisdiction field, so jurisdictions come from the
// optional --jurisdiction flag (comma-separated codes); default is none. The
// printed eval command needs a Google Cloud project for the Vertex judge:
// --project flag, else GOOGLE_CLOUD_PROJECT / GOOGLE_VERTEX_PROJECT from the
// environment, else an interactive prompt.

import path from "node:path"
import { createOpencodeClient } from "@opencode-ai/sdk"

const INGEST = "http://127.0.0.1:4500"
const ENGINE = "http://127.0.0.1:4096"

const argv = Bun.argv.slice(2)
const flags = ["--jurisdiction", "--project", "--location", "--judge-model"]
const flagValue = (name: string) => {
  const i = argv.indexOf(name)
  return i === -1 ? undefined : argv[i + 1]
}
const jurisdictions = flagValue("--jurisdiction")?.split(",") ?? []
const positional = argv.filter((arg, i) => !flags.includes(arg) && !flags.includes(argv[i - 1]))
const taskDir = positional[0]
if (!taskDir) {
  console.error(
    "usage: bun eval/run-harvey-task.ts <task-dir> [run-id] [--jurisdiction US-CA,US-NY] [--project <gcp-project>] [--location <vertex-location>] [--judge-model <model>]",
  )
  process.exit(1)
}
const judgeProject =
  flagValue("--project") ??
  process.env.GOOGLE_CLOUD_PROJECT ??
  process.env.GOOGLE_VERTEX_PROJECT ??
  prompt("Google Cloud project ID for the eval judge (Vertex):")
if (!judgeProject) throw new Error("a Google Cloud project ID is required for the eval command")
const judgeLocation = flagValue("--location") ?? process.env.GOOGLE_CLOUD_LOCATION ?? "global"
const judgeModel = flagValue("--judge-model") ?? "gemini-3.1-pro-preview"
const runId = positional[1] ?? `dochaus-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`
const taskSlug = path.basename(taskDir)
// harvey-labs repo root and the area/slug task id the eval harness expects
// (run_eval.py resolves --task against <root>/tasks/).
const harveyRoot = taskDir.split("/tasks/")[0]
const taskId = taskDir.split("/tasks/")[1]

const task = await Bun.file(path.join(taskDir, "task.json")).json()
console.log("task:", task.title)

// Random suffix so reruns never collide with ingest's document exists-guard.
const matterRes = await fetch(`${INGEST}/matters`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: `${taskSlug}-${Math.random().toString(36).slice(2, 8)}`, jurisdictions }),
})
if (!matterRes.ok) throw new Error(`matter create failed: ${matterRes.status} ${await matterRes.text()}`)
const matter = await matterRes.json()
console.log("matter:", matter.id, matter.dir)

// Upload every file under documents/, recursing into scenario subdirectories.
const documentsDir = path.join(taskDir, "documents")
const inputs = [...new Bun.Glob("**/*").scanSync({ cwd: documentsDir })]
for (const rel of inputs) {
  const form = new FormData()
  form.append("file", new File([await Bun.file(path.join(documentsDir, rel)).arrayBuffer()], path.basename(rel)))
  const up = await fetch(`${INGEST}/matters/${matter.id}/documents`, { method: "POST", body: form })
  if (!up.ok) throw new Error(`upload ${rel} failed: ${up.status} ${await up.text()}`)
  console.log("uploaded:", rel)
}
const inputNames = new Set(inputs.map((rel) => path.basename(rel)))

const client = createOpencodeClient({ baseUrl: ENGINE, directory: matter.dir })
const session = await client.session.create({ body: { title: `Harvey LAB: ${taskSlug}` } })
if (!session.data) throw new Error("session create failed")
console.log("session:", session.data.id)

// Auto-approve permission asks (draft-document is "ask" in dochaus config).
const approver = setInterval(async () => {
  const res = await fetch(`${ENGINE}/permission`, { headers: { "x-opencode-directory": matter.dir } }).catch(
    () => null,
  )
  if (!res?.ok) return
  const pending = await res.json()
  for (const p of pending) {
    console.log("approving permission:", p.permission, JSON.stringify(p.metadata).slice(0, 200))
    await fetch(`${ENGINE}/permission/${p.id}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-opencode-directory": matter.dir },
      body: JSON.stringify({ reply: "always" }),
    })
  }
}, 2000)

const result = await client.session.prompt({
  path: { id: session.data.id },
  body: { agent: "drafter", parts: [{ type: "text", text: task.instructions }] },
})
clearInterval(approver)

const text = (result.data?.parts ?? []).flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n")
console.log("\n=== ASSISTANT FINAL ===\n", text)

// Stage deliverables: every .docx in the matter dir that was not an input.
const outDir = path.join(harveyRoot, "results", runId, taskSlug, "output")
const produced = [...new Bun.Glob("*.docx").scanSync({ cwd: matter.dir })].filter((f) => !inputNames.has(f))
if (!produced.length) throw new Error(`no new .docx deliverables found in ${matter.dir}`)
for (const f of produced) {
  await Bun.write(path.join(outDir, f), Bun.file(path.join(matter.dir, f)))
  console.log("staged:", path.join(outDir, f))
}

// run_eval.py reads deliverables from results/<run-id>/output, so the eval
// run id is <run-id>/<task-slug> (matching the existing results/dochaus/...
// layout a previous eval ran against).
console.log("\n=== EVAL COMMAND ===")
console.log(
  // --parallel 1: the default of 6 concurrent judge calls trips Vertex 429
  // rate limits and run_eval has no backoff.
  `cd ${harveyRoot} && GOOGLE_GENAI_USE_VERTEXAI=true GOOGLE_CLOUD_PROJECT=${judgeProject} GOOGLE_CLOUD_LOCATION=${judgeLocation} uv run python -m evaluation.run_eval --run-id ${runId}/${taskSlug} --task ${taskId} --judge-model ${judgeModel} --parallel 1`,
)
