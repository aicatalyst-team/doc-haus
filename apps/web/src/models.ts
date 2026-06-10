// Model-default curation shared by the onboarding and settings model pickers.
// Both screens select a provider first and then a default + fast model from that
// one provider, so the two never straddle providers — the Auto router runs the
// fast model, and a fast model on a different provider than the primary is a
// misconfiguration (see routeAgent in api/opencode.ts).

export type ModelOption = { value: string; label: string; providerId: string; modelId: string }

// Curated best primary + fast model per provider, as ordered model-id patterns:
// the first pattern that matches a real catalog id wins. Order encodes the
// preference, so for Bedrock the global cross-region inference profile is tried
// before any single-region variant. Patterns, not hardcoded ids, so a catalog
// refresh that renames a variant still resolves.
export const MODEL_PREFS: Record<string, { primary: RegExp[]; fast: RegExp[] }> = {
  // Anthropic on Bedrock — Opus 4.8 primary, Haiku 4.5 fast, both via the global
  // inference profile (global.anthropic.*) when available.
  "amazon-bedrock": {
    primary: [/^global\.anthropic\.claude-opus-4-8/i, /anthropic\.claude-opus-4-8/i],
    fast: [/^global\.anthropic\.claude-haiku-4-5/i, /anthropic\.claude-haiku-4-5/i],
  },
  // Vertex — Gemini 3.5 Flash for both primary and fast.
  "google-vertex": {
    primary: [/^gemini-3\.5-flash$/i, /gemini-3\.5-flash/i],
    fast: [/^gemini-3\.5-flash$/i, /gemini-3\.5-flash/i],
  },
  // Azure OpenAI — GPT-5.5 primary, its mini variant for fast.
  azure: {
    primary: [/^gpt-5\.5$/i, /gpt-5\.5(?!.*mini)(?!.*nano)/i],
    fast: [/gpt-5\.5-mini/i, /o4-mini/i, /mini/i],
  },
}

// Provider priority for first-run defaults, chosen rather than catalog order:
// Vertex/Gemini is the doc.haus default, then Bedrock, then Azure.
export const PROVIDER_PRIORITY = ["google-vertex", "amazon-bedrock", "azure"]

// The provider id of a "providerID/modelID" config string.
export const providerOf = (value: string) => value.split("/")[0] ?? ""

// The provider to seed a fresh picker with: the highest-priority one that
// resolves a curated primary, else the highest-priority one merely present, else
// whatever the first model belongs to.
export function defaultProvider(models: ModelOption[]) {
  const resolves = (id: string) =>
    (MODEL_PREFS[id]?.primary ?? []).some((re) => models.some((m) => m.providerId === id && re.test(m.modelId)))
  return (
    PROVIDER_PRIORITY.find(resolves) ??
    PROVIDER_PRIORITY.find((id) => models.some((m) => m.providerId === id)) ??
    models[0]?.providerId ??
    ""
  )
}

// The default primary + fast pair within a single provider: the first curated
// match for each slot, falling back to the first model (primary) and an obvious
// cheap model (fast) for a provider without a curated entry. Both values are
// always from this provider, so they cannot straddle providers.
export function pickForProvider(models: ModelOption[], providerId: string) {
  const inProvider = models.filter((m) => m.providerId === providerId)
  const match = (kind: "primary" | "fast") =>
    (MODEL_PREFS[providerId]?.[kind] ?? []).map((re) => inProvider.find((m) => re.test(m.modelId))).find(Boolean)?.value
  const primary = match("primary") ?? inProvider[0]?.value ?? ""
  const fast =
    match("fast") ?? inProvider.find((m) => /flash|mini|haiku|lite|nano|small|fast/i.test(m.label))?.value ?? primary
  return { primary, fast }
}

// The default primary + fast across the whole catalog: pick the priority provider,
// then its in-provider pair. Used to seed onboarding before any provider is chosen.
export function pickDefaults(models: ModelOption[]) {
  return pickForProvider(models, defaultProvider(models))
}
