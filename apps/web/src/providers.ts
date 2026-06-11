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
