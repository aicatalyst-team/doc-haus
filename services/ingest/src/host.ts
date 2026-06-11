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
