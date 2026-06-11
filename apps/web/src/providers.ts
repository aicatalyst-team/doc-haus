import { probeModel } from "./models"
import { getProviderOptions, probeProvider, type Client } from "./api/opencode"
import { probeVertexHost } from "./api/ingest"

// Host-credential providers (Google Vertex, Vertex Anthropic, Amazon Bedrock) are
// reported "connected" by the engine on project/region presence alone — it never
// checks the gcloud ADC / AWS sign-in actually resolves (see provider.ts:494,
// autoload = Boolean(project)). So a project leaking in from the host env lists
// them as ready with the full models.dev catalog even with zero credentials, and
// they only fail at the first real call. The web gates them out of every model
// picker until a live probe (probeProvider) confirms real credentials, and
// remembers the ones that passed across reloads. Both the onboarding modal and
// full Settings share this gate so they can never disagree about what's pickable.
export const GATED_PROVIDERS = new Set(["google-vertex", "google-vertex-anthropic", "amazon-bedrock"])

export const isGated = (id: string) => GATED_PROVIDERS.has(id)

// localStorage (not engine config) because it is a per-browser UI gate over the
// engine's auth, not an engine setting — the engine has no notion of "verified".
const VERIFIED_KEY = "dochaus.verifiedProviders"
export function loadVerified(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(VERIFIED_KEY) ?? "[]") as string[])
  } catch {
    return new Set()
  }
}
export function saveVerified(ids: Set<string>) {
  localStorage.setItem(VERIFIED_KEY, JSON.stringify([...ids]))
}

// A verified flag is per-browser but the credentials it vouches for live on the
// engine's host — point the same browser at a different engine (a fresh Docker
// container, another machine) and it carries flags that engine never earned, so
// onboarding would announce "Detected Google Vertex" with zero credentials
// behind it. Re-prove every cached flag with the same live probe that minted it
// (Settings' enable(): host ADC probe for Vertex with a saved project, engine
// prompt probe otherwise) and persist the survivors, so a stale flag dies here
// instead of at the user's first real prompt.
export async function revalidateVerified(
  client: Client,
  providers: { id: string; models: Record<string, unknown> }[],
  connected: Set<string>,
): Promise<Set<string>> {
  const cached = loadVerified()
  const passed = await Promise.all(
    [...cached].map(async (id) => {
      const provider = providers.find((p) => p.id === id)
      if (!provider || !connected.has(id)) return null
      const modelID = probeModel(id, Object.keys(provider.models))
      if (!modelID) return null
      const vertex = id === "google-vertex" || id === "google-vertex-anthropic"
      const options = vertex ? await getProviderOptions(id) : {}
      const result =
        vertex && options.project
          ? await probeVertexHost({
              project: options.project,
              location: options.location || "global",
              publisher: id === "google-vertex" ? "google" : "anthropic",
              model: modelID,
            })
          : await probeProvider(client, id, modelID)
      return result.ok ? id : null
    }),
  )
  const next = new Set(passed.filter((id): id is string => id !== null))
  if (next.size !== cached.size) saveVerified(next)
  return next
}
