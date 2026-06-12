#!/usr/bin/env bun
// Headless suite runner for the Harvey LAB benchmark: discovers every task
// under <tasks-root>/<area>/<slug>/ and runs each one through local doc.haus
// by spawning eval/run-harvey-task.ts once per task — strictly serially, with
// a cooldown between tasks, a per-task timeout, and a retry ladder for Vertex
// 429 / RESOURCE_EXHAUSTED failures. Quotas are tight: this never runs two
// tasks concurrently and never hounds the services after a rate limit.
//
// Requires the stack running: `opencode serve` on :4096 and services/ingest on
// :4500. Run from the dochaus package directory (dependencies live there):
//
//   bun eval/run-harvey-suite.ts \
//     --tasks-root ~/path/to/harvey-labs/tasks \
//     [run-id] [--area immigration,tax] [--task offer-letter] [--limit 10] \
//     [--cooldown 20] [--task-timeout 25] [--dry-run] \
//     [--jurisdiction US-CA,US-NY] [--project <gcp-project>] \
//     [--location <vertex-location>] [--judge-model <model>]
//
// --jurisdiction/--project/--location/--judge-model pass straight through to
// the single-task runner. The judge project comes from --project or
// GOOGLE_CLOUD_PROJECT / GOOGLE_VERTEX_PROJECT — never hardcoded, and resolved
// up front so the child never falls back to its interactive prompt. Outputs
// land at results/<run-id>/<area>/<slug>/output in the harvey-labs tree, and
// given the same run-id any task whose output dir is already non-empty is
// skipped, so a crashed suite resumes where it left off.

import path from "node:path"
import { existsSync, readdirSync } from "node:fs"

const ENGINE = "http://127.0.0.1:4096"

const argv = Bun.argv.slice(2)
const valueFlags = [
  "--tasks-root",
  "--area",
  "--task",
  "--limit",
  "--cooldown",
  "--task-timeout",
  "--jurisdiction",
  "--project",
  "--location",
  "--judge-model",
]
const flagValue = (name: string) => {
  const i = argv.indexOf(name)
  return i === -1 ? undefined : argv[i + 1]
}
const dryRun = argv.includes("--dry-run")
const positional = argv.filter(
  (arg, i) => !valueFlags.includes(arg) && !valueFlags.includes(argv[i - 1]) && arg !== "--dry-run",
)

const tasksRootArg = flagValue("--tasks-root")
if (!tasksRootArg) {
  console.error(
    "usage: bun eval/run-harvey-suite.ts --tasks-root <harvey-labs/tasks> [run-id] [--area a,b] [--task substring] [--limit n] [--cooldown seconds] [--task-timeout minutes] [--dry-run] [--jurisdiction US-CA,US-NY] [--project <gcp-project>] [--location <vertex-location>] [--judge-model <model>]",
  )
  process.exit(1)
}
const tasksRoot = path.resolve(tasksRootArg)
// run-harvey-task.ts derives the harvey-labs root by splitting the task dir on
// its FIRST "/tasks/", so the root must literally be the tasks/ directory and
// no ancestor may contain a /tasks/ segment — otherwise the child stages
// results against the wrong root and resume never matches.
if (path.basename(tasksRoot) !== "tasks" || tasksRoot.split("/tasks/").length > 1)
  throw new Error(`--tasks-root must point at the harvey-labs tasks/ directory with no other /tasks/ in its path, got ${tasksRoot}`)
const harveyRoot = path.dirname(tasksRoot)

const runId = positional[0] ?? `dochaus-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`
const cooldownMs = Number(flagValue("--cooldown") ?? 20) * 1000
const taskTimeoutMs = Number(flagValue("--task-timeout") ?? 25) * 60 * 1000
const limit = Number(flagValue("--limit") ?? Infinity)
const areas = flagValue("--area")?.split(",")
const slugFilter = flagValue("--task")

// A task is any directory holding a task.json. Most sit at <area>/<slug>, but
// some tasks split into <area>/<slug>/scenario-NN subdirectories, each a task
// of its own (1251 total per the harness README). `dir` is the path relative
// to tasks/ and doubles as the --task id run_eval.py resolves.
const selected = [...new Bun.Glob("*/**/task.json").scanSync({ cwd: tasksRoot })]
  .map((rel) => path.dirname(rel))
  .map((dir) => ({ dir, area: dir.split("/")[0], slug: dir.split("/").slice(1).join("/") }))
  .filter((t) => !areas || areas.includes(t.area))
  .filter((t) => !slugFilter || t.slug.includes(slugFilter))
  .sort((a, b) => a.dir.localeCompare(b.dir))
  .slice(0, limit)

if (dryRun) {
  for (const t of selected) console.log(t.dir)
  console.log(`\n${selected.length} task(s) selected (run-id ${runId})`)
  process.exit(0)
}

// Resolve the judge project here so the spawned runner never reaches its
// interactive prompt() fallback, which would hang a non-TTY suite run.
const judgeProject = flagValue("--project") ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GOOGLE_VERTEX_PROJECT
if (!judgeProject) throw new Error("a Google Cloud project ID is required: pass --project or set GOOGLE_CLOUD_PROJECT / GOOGLE_VERTEX_PROJECT")
const judgeLocation = flagValue("--location") ?? process.env.GOOGLE_CLOUD_LOCATION ?? "global"
const judgeModel = flagValue("--judge-model") ?? "gemini-3.1-pro-preview"
const passthrough = [
  "--project",
  judgeProject,
  ...(flagValue("--jurisdiction") ? ["--jurisdiction", flagValue("--jurisdiction")!] : []),
  ...(flagValue("--location") ? ["--location", flagValue("--location")!] : []),
  ...(flagValue("--judge-model") ? ["--judge-model", flagValue("--judge-model")!] : []),
]

const manifestPath = path.join(harveyRoot, "results", runId, "suite-manifest.json")
console.log(`suite: ${selected.length} task(s), run-id ${runId}, manifest ${manifestPath}`)

const records: { slug: string; area: string; status: string; durationMs: number; attempts: number }[] = []
for (const [i, t] of selected.entries()) {
  console.log(`\n=== [${i + 1}/${selected.length}] ${t.dir} ===`)

  // The child stages output under results/<child-run-id>/<basename(taskDir)>,
  // so nest the child run-id by the task's parent path: every task lands at
  // results/<runId>/<area>/<slug>/output with no basename collisions between
  // the scenario-NN tasks of different parents.
  const childRunId = path.join(runId, path.dirname(t.dir))

  // Resume: skip tasks that already staged deliverables under this run-id.
  const outputDir = path.join(harveyRoot, "results", runId, t.dir, "output")
  if (existsSync(outputDir) && readdirSync(outputDir).length > 0) {
    console.log(`skipped: ${outputDir} already has output`)
    await record({ slug: t.slug, area: t.area, status: "skipped", durationMs: 0, attempts: 0 })
    continue
  }

  const started = Date.now()
  const result = await runTask(path.join(tasksRoot, t.dir), childRunId)
  await record({ slug: t.slug, area: t.area, durationMs: Date.now() - started, ...result })
  console.log(`result: ${result.status} (attempts ${result.attempts})`)

  // Cooldown between live runs so the drafting model never hammers Vertex.
  if (i < selected.length - 1) {
    console.log(`cooldown: ${cooldownMs / 1000}s`)
    await Bun.sleep(cooldownMs)
  }
}

const counts = records.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {})
console.log("\n=== SUITE SUMMARY ===")
console.log(`ok: ${counts.ok ?? 0}  failed: ${counts.failed ?? 0}  timeout: ${counts.timeout ?? 0}  skipped: ${counts.skipped ?? 0}`)
console.log(`manifest: ${manifestPath}`)

// run_eval.py reads deliverables from results/<run-id>/output, so each task is
// scored as run-id <run-id>/<slug>. --parallel 1 because the default of 6
// concurrent judge calls trips Vertex 429 rate limits and run_eval has no
// backoff.
console.log("\n=== EVAL COMMAND (run once per completed task) ===")
console.log(
  `cd ${harveyRoot} && GOOGLE_GENAI_USE_VERTEXAI=true GOOGLE_CLOUD_PROJECT=${judgeProject} GOOGLE_CLOUD_LOCATION=${judgeLocation} uv run python -m evaluation.run_eval --run-id ${runId}/<area>/<slug> --task <area>/<slug> --judge-model ${judgeModel} --parallel 1`,
)
console.log("\nThe generation run just burned Vertex quota — wait ~5 minutes before judging.")
process.exit((counts.failed ?? 0) + (counts.timeout ?? 0) > 0 ? 1 : 0)

// One task = one spawn of the single-task runner, with a kill timer and a
// retry ladder for quota failures: 429 -> wait 5 min, retry; 429 again ->
// wait 10 min, retry; third failure is final.
async function runTask(taskDir: string, childRunId: string) {
  const backoffsMs = [5 * 60 * 1000, 10 * 60 * 1000]
  for (let attempt = 1; attempt <= backoffsMs.length + 1; attempt++) {
    const child = Bun.spawn(["bun", "eval/run-harvey-task.ts", taskDir, childRunId, ...passthrough], {
      stdout: "pipe",
      stderr: "pipe",
    })
    // The child prints "matter: <id> <dir>" and "session: <id>" as it boots;
    // watch its output for them so a timeout can abort the drafter session
    // server-side — killing the client alone leaves `opencode serve` burning
    // Vertex quota on the orphaned run, effectively running two tasks at once.
    let matterDir: string | undefined
    let sessionId: string | undefined
    const watch = (accumulated: string) => {
      matterDir ??= accumulated.match(/^matter: \S+ (\S+)/m)?.[1]
      sessionId ??= accumulated.match(/^session: (\S+)/m)?.[1]
    }
    let timedOut = false
    let aborted: Promise<unknown> = Promise.resolve()
    const killer = setTimeout(() => {
      timedOut = true
      child.kill()
      if (sessionId && matterDir)
        aborted = fetch(`${ENGINE}/session/${sessionId}/abort`, {
          method: "POST",
          headers: { "x-opencode-directory": matterDir },
        }).catch(() => null)
    }, taskTimeoutMs)
    const [out, err] = await Promise.all([tee(child.stdout, process.stdout, watch), tee(child.stderr, process.stderr)])
    const code = await child.exited
    clearTimeout(killer)
    if (code === 0) return { status: "ok", attempts: attempt }
    if (timedOut) {
      await aborted
      console.log(sessionId ? `aborted session ${sessionId}` : "no session id seen; nothing to abort")
      return { status: "timeout", attempts: attempt }
    }
    // Vertex quota errors carry RESOURCE_EXHAUSTED or "429 Too Many Requests";
    // never match a bare "429" — the echoed output includes the drafted
    // document, where "§ 429" would turn an ordinary failure into a 15-minute
    // retry ladder.
    const quota = /RESOURCE_EXHAUSTED|Too Many Requests/i.test(`${out}${err}`)
    if (!quota || attempt > backoffsMs.length) return { status: "failed", attempts: attempt }
    console.log(`rate limited (attempt ${attempt}): waiting ${backoffsMs[attempt - 1] / 60000} min before retry`)
    await Bun.sleep(backoffsMs[attempt - 1])
  }
  return { status: "failed", attempts: backoffsMs.length + 1 }
}

// Echo child output live while accumulating it for 429 detection. `spy` sees
// the accumulated text after every chunk (used to capture session/matter ids).
async function tee(stream: ReadableStream<Uint8Array>, sink: NodeJS.WriteStream, spy?: (accumulated: string) => void) {
  const decoder = new TextDecoder()
  const chunks: string[] = []
  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true })
    chunks.push(text)
    sink.write(text)
    spy?.(chunks.join(""))
  }
  return chunks.join("")
}

// Rewrite the manifest after every task so a crash loses nothing.
async function record(entry: (typeof records)[number]) {
  records.push(entry)
  const existing: (typeof records)[number][] = existsSync(manifestPath) ? await Bun.file(manifestPath).json() : []
  existing.push(entry)
  await Bun.write(manifestPath, JSON.stringify(existing, null, 2))
}
