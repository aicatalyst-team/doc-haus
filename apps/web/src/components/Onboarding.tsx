import { useEffect, useMemo, useState } from "react"
import {
  addLocalProvider,
  getConfig,
  listProviders,
  setDefaultModel,
  setProviderKey,
  setSmallModel,
  settingsClient,
  type Client,
} from "../api/opencode"

type Provider = Awaited<ReturnType<typeof listProviders>>["all"][number]

// First-run onboarding. Auto-detects the providers the engine already has
// credentials for — host sign-ins and environment (Vertex ADC, Bedrock,
// AWS/Azure SDK creds), or a key typed below — then asks only for the two
// choices that matter to start: the primary and fast models. When nothing is
// detected it first asks to connect a cloud provider or a local (Ollama)
// endpoint, then advances to the model picker once models appear. Advanced
// controls (provider toggles, cloud project/region) stay in full Settings.
export default function Onboarding({ onClose, onOpenSettings }: { onClose: () => void; onOpenSettings: () => void }) {
  const client = useMemo<Client>(() => settingsClient(), [])
  const [all, setAll] = useState<Provider[]>([])
  const [connected, setConnected] = useState<Set<string>>(new Set())
  const [primary, setPrimary] = useState("")
  const [fast, setFast] = useState("")
  const [notice, setNotice] = useState("")
  // Reveal the connect step even when models are detected, so a user with one
  // provider ready can still wire up another before choosing.
  const [forceConnect, setForceConnect] = useState(false)

  // Cloud add: which provider is picked in the select, and its key.
  const [pick, setPick] = useState("")
  const [key, setKey] = useState("")
  // Local endpoint: defaults aimed at a stock Ollama install.
  const [localName, setLocalName] = useState("Ollama")
  const [localURL, setLocalURL] = useState("http://localhost:11434/v1")
  const [localModel, setLocalModel] = useState("")

  async function load() {
    const [providers, cfg] = await Promise.all([listProviders(client), getConfig()])
    setAll(providers.all)
    setConnected(new Set(providers.connected))
    // Seed from any model already saved so re-opening shows the live config.
    setPrimary((p) => p || cfg.model || "")
    setFast((f) => f || cfg.small_model || "")
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const connectedProviders = all.filter((p) => connected.has(p.id))

  // Every model across connected providers as "providerID/modelID" strings, for
  // both pickers — same shape the engine expects for model + small_model.
  const models = useMemo(
    () =>
      connectedProviders
        .flatMap((p) =>
          Object.values(p.models).map((m) => ({
            value: `${p.id}/${m.id}`,
            label: `${p.name} — ${m.name}`,
            providerId: p.id,
            modelId: m.id,
          })),
        )
        .sort((a, b) => a.label.localeCompare(b.label)),
    [all, connected],
  )

  // Once models become available, preselect the best primary + fast for whatever
  // provider was detected (see MODEL_PREFS), so the modal is one confirming click.
  useEffect(() => {
    if (!models.length) return
    const defaults = pickDefaults(models)
    setPrimary((p) => p || defaults.primary)
    setFast((f) => f || defaults.fast)
  }, [models])

  // Providers connectable with a typed API key: the whole catalog minus ones
  // already ready, since any provider is keyable through auth.set.
  const keyProviders = all
    .filter((p) => !connected.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name))

  const showConnect = forceConnect || models.length === 0

  return (
    <div className="viewer-overlay" onClick={onClose}>
      <div className="picker-panel settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-bar">
          <span className="viewer-title">Welcome to doc.haus</span>
          <button onClick={onClose}>Skip</button>
        </div>
        <div className="picker-body">
          {notice && <p className="settings-notice">{notice}</p>}

          {!showConnect ? (
            <>
              <p className="settings-notice">
                Detected {connectedProviders.map((p) => p.name).join(", ")}. Pick your models to get started.
              </p>

              <section className="settings-section">
                <h3>Primary model</h3>
                <p className="settings-hint muted">Handles every matter unless an assistant pins its own model.</p>
                <div className="row settings-row">
                  <select value={primary} onChange={(e) => setPrimary(e.target.value)}>
                    <option value="">Select a model</option>
                    {models.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </section>

              <section className="settings-section">
                <h3>Fast model</h3>
                <p className="settings-hint muted">
                  A cheap model for quick tasks — title generation and routing the chat's Auto assistant.
                </p>
                <div className="row settings-row">
                  <select value={fast} onChange={(e) => setFast(e.target.value)}>
                    <option value="">Same as primary</option>
                    {models.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </section>

              <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}>
                <button onClick={() => setForceConnect(true)}>Use a different provider</button>
                <button
                  className="primary"
                  disabled={!primary}
                  onClick={async () => {
                    await setDefaultModel(primary)
                    // No fast pick -> fall back to the primary so Auto routing and
                    // title generation still have a model to call.
                    await setSmallModel(fast || primary)
                    onClose()
                  }}
                >
                  Get started
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="settings-notice">
                No model provider detected. Connect a cloud provider with an API key, or point doc.haus at a local
                endpoint like Ollama.
              </p>

              <section className="settings-section">
                <h3>Cloud provider</h3>
                <p className="settings-hint muted">
                  OpenAI, Anthropic, Groq and others. The key is stored on the engine, never in the browser.
                </p>
                <div className="row settings-row">
                  <select value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">Choose a provider</option>
                    {keyProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="password"
                    placeholder="API key"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    disabled={!pick}
                  />
                  <button
                    className="primary"
                    disabled={!pick || !key.trim()}
                    onClick={async () => {
                      const name = all.find((p) => p.id === pick)?.name ?? pick
                      await setProviderKey(client, pick, key.trim())
                      setPick("")
                      setKey("")
                      setForceConnect(false)
                      setNotice(`Connected ${name}. Pick your models below.`)
                      await load()
                    }}
                  >
                    Connect
                  </button>
                </div>
              </section>

              <section className="settings-section">
                <h3>Local endpoint (Ollama)</h3>
                <p className="settings-hint muted">
                  Any OpenAI-compatible server — Ollama, LM Studio, vLLM. The URL must be reachable from the machine
                  running the engine, not the browser.
                </p>
                <div className="settings-grid">
                  <label className="settings-label">Name</label>
                  <input value={localName} onChange={(e) => setLocalName(e.target.value)} />
                  <label className="settings-label">Base URL</label>
                  <input value={localURL} onChange={(e) => setLocalURL(e.target.value)} />
                  <label className="settings-label">Model id</label>
                  <input placeholder="llama3.1" value={localModel} onChange={(e) => setLocalModel(e.target.value)} />
                  <button
                    className="primary settings-add"
                    disabled={!localName.trim() || !localURL.trim() || !localModel.trim()}
                    onClick={async () => {
                      const id = localName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")
                      await addLocalProvider({
                        id,
                        name: localName.trim(),
                        baseURL: localURL.trim(),
                        modelID: localModel.trim(),
                      })
                      setLocalModel("")
                      setForceConnect(false)
                      setNotice(`Added ${localName.trim()}. Pick your models below — restart the engine if it's missing.`)
                      await load()
                    }}
                  >
                    Add endpoint
                  </button>
                </div>
              </section>

              {forceConnect && models.length > 0 && (
                <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
                  <button onClick={() => setForceConnect(false)}>Back to model picker</button>
                </div>
              )}
            </>
          )}

          <p className="settings-hint muted" style={{ marginTop: 16 }}>
            Need a cloud project/region or to manage providers?{" "}
            <button className="linklike" onClick={onOpenSettings}>
              Open full settings
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}

type ModelOption = { value: string; label: string; providerId: string; modelId: string }

// Curated best primary + fast model per provider, as ordered model-id patterns:
// the first pattern that matches a real catalog id wins. Order encodes the
// preference, so for Bedrock the global cross-region inference profile is tried
// before any single-region variant. Patterns, not hardcoded ids, so a catalog
// refresh that renames a variant still resolves.
const MODEL_PREFS: Record<string, { primary: RegExp[]; fast: RegExp[] }> = {
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

// First-run defaults favour one provider for BOTH slots, chosen by this priority
// rather than catalog order: Vertex/Gemini is the doc.haus default, then Bedrock,
// then Azure. Both models coming from the same provider keeps them from straddling
// providers — the Auto router runs the fast model, so a fast model on a different
// provider than the primary is a misconfiguration (see routeAgent).
const PROVIDER_PRIORITY = ["google-vertex", "amazon-bedrock", "azure"]

// Both defaults come from the first priority provider present in the catalog that
// resolves a curated primary: Vertex -> Gemini 3.5 Flash for both; Bedrock -> Opus
// 4.8 (global) primary, Haiku 4.5 (global) fast. With no curated provider present,
// fall back to the first model as primary and an obvious cheap model as fast.
function pickDefaults(models: ModelOption[]) {
  const match = (id: string, kind: "primary" | "fast") =>
    (MODEL_PREFS[id]?.[kind] ?? [])
      .map((re) => models.find((m) => m.providerId === id && re.test(m.modelId)))
      .find(Boolean)?.value
  for (const id of PROVIDER_PRIORITY) {
    const primary = match(id, "primary")
    if (primary) return { primary, fast: match(id, "fast") ?? primary }
  }
  const primary = models[0].value
  const fast = models.find((m) => /flash|mini|haiku|lite|nano|small|fast/i.test(m.label))?.value ?? primary
  return { primary, fast }
}
