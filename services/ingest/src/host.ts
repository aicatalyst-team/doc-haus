import os from "node:os"
import path from "node:path"

// Host-credential discovery for the web's provider-setup UI: which GCP projects
// the server's gcloud ADC can see, and which AWS profiles its ~/.aws files
// define. Both live on the host the engine runs on — the browser cannot see
// them — and both resolve to empty lists when the host has no such sign-in, so
// the UI's fields degrade to plain typing.

// The projects the host's ADC token can list, via Cloud Resource Manager. The
// token comes from the gcloud CLI rather than a Google SDK so the ingest
// service needs no GCP dependency — the same sign-in the engine's Vertex calls
// rely on is the one being enumerated.
export async function listGcpProjects() {
  const proc = Bun.spawn(["gcloud", "auth", "application-default", "print-access-token"], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const token = (await new Response(proc.stdout).text()).trim()
  if ((await proc.exited) !== 0 || !token) return []
  const res = await fetch("https://cloudresourcemanager.googleapis.com/v1/projects?filter=lifecycleState:ACTIVE", {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return []
  const body = (await res.json()) as { projects?: { projectId: string }[] }
  return (body.projects ?? []).map((p) => p.projectId).sort()
}

// One real, cheap Vertex call with the host's ADC token, so the web can verify
// a project/location before unlocking the provider — without going through the
// engine's session machinery, whose first touch cold-boots a second instance
// and can outlast any sane probe timeout. Gemini and Anthropic publisher models
// take different request shapes, so the probe branches on publisher. Returns
// Google's error message verbatim (wrong project, API not enabled, no quota).
export async function probeVertex(input: { project: string; location: string; publisher: string; model: string }) {
  const proc = Bun.spawn(["gcloud", "auth", "application-default", "print-access-token"], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const token = (await new Response(proc.stdout).text()).trim()
  if ((await proc.exited) !== 0 || !token)
    return { ok: false, error: "No gcloud ADC sign-in on the server — run: gcloud auth application-default login" }
  const host =
    input.location === "global" ? "aiplatform.googleapis.com" : `${input.location}-aiplatform.googleapis.com`
  const anthropic = input.publisher === "anthropic"
  const url = `https://${host}/v1/projects/${input.project}/locations/${input.location}/publishers/${input.publisher}/models/${input.model}:${anthropic ? "rawPredict" : "generateContent"}`
  const body = anthropic
    ? { anthropic_version: "vertex-2023-10-16", max_tokens: 1, messages: [{ role: "user", content: "ping" }] }
    : { contents: [{ role: "user", parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 1 } }
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  if (res.ok) return { ok: true }
  const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  return { ok: false, error: err?.error?.message ?? `HTTP ${res.status}` }
}

// Profile names from ~/.aws/config ([profile x] plus the bare [default]) and
// ~/.aws/credentials ([x]), deduped.
export async function listAwsProfiles() {
  const read = (file: string) =>
    Bun.file(path.join(os.homedir(), ".aws", file))
      .text()
      .catch(() => "")
  const [config, credentials] = await Promise.all([read("config"), read("credentials")])
  const names = [
    ...[...config.matchAll(/^\[profile ([^\]]+)\]/gm)].map((m) => m[1].trim()),
    ...(/^\[default\]/m.test(config) ? ["default"] : []),
    ...[...credentials.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1].trim()),
  ]
  return [...new Set(names)].sort()
}
