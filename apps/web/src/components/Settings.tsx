import { useEffect, useMemo, useState } from "react"
import {
  addLocalProvider,
  getConfig,
  getProviderOptions,
  listAuthMethods,
  listProviders,
  probeProvider,
  setDefaultModel,
  setDisabledProviders,
  setProviderKey,
  setProviderOptions,
  setSmallModel,
  settingsClient,
  type Client,
} from "../api/opencode"
import { defaultProvider, pickForProvider, providerOf } from "../models"
import { isGated, loadVerified, saveVerified } from "../providers"

type Provider = Awaited<ReturnType<typeof listProviders>>["all"][number]
type Methods = Record<string, { type: "oauth" | "api"; label: string }[]>

// Engine-wide settings: connect model providers, add a local endpoint, and pick
// the default model. These act on the engine's global config + auth store (not a
// matter), so the modal opens from the app header. The flow reads top-down the
// way you set it up: see what's connected, connect more, then choose a model.
export default function Settings({ onClose, firstRun = false }: { onClose: () => void; firstRun?: boolean }) {
  const client = useMemo<Client>(() => settingsClient(), [])
  const [all, setAll] = useState<Provider[]>([])
  const [connected, setConnected] = useState<Set<string>>(new Set())
  const [methods, setMethods] = useState<Methods>({})
  // Both models are locked to one provider so they can never straddle clouds
  // (the Auto router runs the fast model — see routeAgent).
  const [provider, setProvider] = useState("")
  const [model, setModel] = useState("")
  // The engine's small/fast model, used for title generation and for routing the
  // chat's "Auto" assistant. Picked from the same provider models as the default.
  const [smallModel, setSmallModelValue] = useState("")
  const [disabled, setDisabled] = useState<string[]>([])
  const [notice, setNotice] = useState("")

  // Host-credential providers (Vertex/Bedrock) report "connected" on project/region
  // presence alone — the engine never checks the sign-in actually resolves. So we
  // keep them out of the model picker until a live probe (probeProvider) confirms
  // real credentials, and remember the ones that passed across reloads.
  const [verified, setVerified] = useState<Set<string>>(loadVerified)
  const [probing, setProbing] = useState("")
  const [probeErr, setProbeErr] = useState<Record<string, string>>({})

  // Cloud add: which provider is picked in the select, and its key.
  const [pick, setPick] = useState("")
  const [key, setKey] = useState("")

  async function load() {
    const [providers, auth, cfg] = await Promise.all([
      listProviders(client),
      listAuthMethods(client),
      getConfig(),
    ])
    setAll(providers.all)
    setConnected(new Set(providers.connected))
    setMethods(auth)
    setModel(cfg.model ?? "")
    setSmallModelValue(cfg.small_model ?? "")
    setDisabled(cfg.disabled_providers ?? [])
  }

  // Enable/disable a provider by editing config.disabled_providers. A disabled
  // provider drops out of the catalog entirely, so we flip local state straight
  // away (the engine reports stale `connected` right after the write) and keep
  // the name around to label its row once it leaves `all`.
  const nameByID = new Map(all.map((p) => [p.id, p.name] as const))
  // Remember names of providers we disable, since they vanish from `all`.
  const [nameMemo, setNameMemo] = useState<Record<string, string>>({})
  async function toggle(id: string, name: string, enable: boolean) {
    const next = enable ? disabled.filter((x) => x !== id) : [...disabled, id]
    setDisabled(next)
    setConnected((prev) => {
      const n = new Set(prev)
      if (enable) n.add(id)
      else n.delete(id)
      return n
    })
    setNameMemo((m) => ({ ...m, [id]: name }))
    await setDisabledProviders(next)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const connectedProviders = all.filter((p) => connected.has(p.id))

  // Vertex/Bedrock need a passing credential probe before they count as ready;
  // every other (API-key/OAuth) provider is ready the moment it's connected.
  const readyProviders = connectedProviders.filter((p) => !isGated(p.id) || verified.has(p.id))

  // Host-credential providers in the catalog that haven't passed a probe yet —
  // shown under "Needs setup" with their project/region fields and an Enable button.
  const needsSetup = all.filter((p) => isGated(p.id) && !verified.has(p.id))

  // Probe a host provider's credentials with one real call; on success mark it
  // verified (persisted) so it joins the picker, on failure surface the engine's
  // credential error and keep it gated.
  async function enable(p: Provider) {
    const modelID = Object.keys(p.models)[0]
    if (!modelID) return setProbeErr((e) => ({ ...e, [p.id]: "Provider has no models to test." }))
    setProbing(p.id)
    setProbeErr((e) => ({ ...e, [p.id]: "" }))
    const result = await probeProvider(client, p.id, modelID)
    setProbing("")
    if (!result.ok) return setProbeErr((e) => ({ ...e, [p.id]: result.error }))
    setVerified((prev) => {
      const next = new Set(prev).add(p.id)
      saveVerified(next)
      return next
    })
    setNotice(`${p.name} verified.`)
  }

  // Drop a host provider back to "Needs setup" so its project/region can be changed
  // and re-verified.
  function unverify(id: string) {
    setVerified((prev) => {
      const next = new Set(prev)
      next.delete(id)
      saveVerified(next)
      return next
    })
  }

  // Providers re-enabled this session won't be back in `all` until the engine
  // refreshes its catalog, so render them from the connected set directly.
  const extraReady = [...connected].filter((id) => !all.some((p) => p.id === id))

  // Providers you can connect with a typed API key. Any catalog provider is
  // keyable through auth.set, so we list the whole catalog (minus ones already
  // ready from host credentials) rather than only providers with a special auth
  // plugin — otherwise OpenAI, Google AI Studio, and Anthropic-by-key would be
  // missing, since they ship no auth hook.
  const keyProviders = all
    .filter((p) => !connected.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Every model across connected providers, as the "providerID/modelID" strings
  // the engine expects, for the model pickers.
  const models = readyProviders
    .flatMap((p) =>
      Object.values(p.models).map((m) => ({
        value: `${p.id}/${m.id}`,
        label: `${p.name} — ${m.name}`,
        providerId: p.id,
        modelId: m.id,
      })),
    )
    .sort((a, b) => a.label.localeCompare(b.label))

  // Seed the provider from the saved default's provider, else the priority
  // default, once models load. Keep any value already chosen this session.
  useEffect(() => {
    if (!models.length) return
    setProvider((v) => v || providerOf(model) || defaultProvider(models))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.length])

  // Switching provider re-clamps both slots into it: keep a model already on the
  // new provider, otherwise drop to that provider's curated default.
  function changeProvider(id: string) {
    setProvider(id)
    const defaults = pickForProvider(models, id)
    setModel((m) => (providerOf(m) === id ? m : defaults.primary))
    setSmallModelValue((s) => (providerOf(s) === id ? s : defaults.fast))
  }

  const providerModels = models.filter((m) => m.providerId === provider)

  return (
    <div className="viewer-overlay" onClick={onClose}>
      <div className="picker-panel settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-bar">
          <span className="viewer-title">Settings</span>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="picker-body">
          {firstRun && (
            <p className="settings-notice">
              Welcome to doc.haus. Connect a model provider — from a host sign-in (gcloud/AWS), an API key, or a local
              endpoint — then choose your default model to get started.
            </p>
          )}
          {notice && <p className="settings-notice">{notice}</p>}

          <section className="settings-section">
            <h3>Models</h3>
            <p className="settings-hint muted">
              Pick a provider, then a default and a fast model from it — both stay on the one provider, so the Auto
              router (which runs the fast model) can never call across clouds.
            </p>
            <div className="row settings-row">
              <span className="muted">Provider</span>
              <select value={provider} onChange={(e) => changeProvider(e.target.value)} disabled={models.length === 0}>
                <option value="">{models.length ? "Select a provider" : "Connect a provider first"}</option>
                {readyProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="row settings-row">
              <span className="muted">Default</span>
              <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!provider}>
                <option value="">Select a model</option>
                {providerModels.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="row settings-row">
              <span className="muted">Fast</span>
              <select value={smallModel} onChange={(e) => setSmallModelValue(e.target.value)} disabled={!provider}>
                <option value="">Same as default</option>
                {providerModels.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="row settings-row">
              <button
                className="primary"
                disabled={!model}
                onClick={async () => {
                  // Save both slots together so the persisted config is always
                  // same-provider — no window where default and fast disagree.
                  await setDefaultModel(model)
                  await setSmallModel(smallModel || model)
                  // On first run, picking a model is the whole point of the modal —
                  // close once it's saved so the user lands straight in the app.
                  if (firstRun) return onClose()
                  setNotice(`Models saved.`)
                }}
              >
                Save
              </button>
            </div>
          </section>

          <section className="settings-section">
            <h3>Ready to use</h3>
            <p className="settings-hint muted">
              Model providers the engine already has credentials for — picked up from the server's sign-in (a gcloud or
              AWS login on the host). Nothing to set up; pick one as your default model below.
            </p>

            <div className="settings-connected">
              {readyProviders.length === 0 && needsSetup.length === 0 && disabled.length === 0 && (
                <span className="muted">None detected yet. Connect one below.</span>
              )}
              {readyProviders.map((p) => (
                <div key={p.id} className="settings-conn">
                  <span className="settings-conn-name">{p.name}</span>
                  <span className="settings-conn-meta muted">
                    {statusLabel(p, methods)} · {Object.keys(p.models).length} models
                  </span>
                  {isGated(p.id) && (
                    <button className="settings-switch" onClick={() => unverify(p.id)}>
                      Reconfigure
                    </button>
                  )}
                  <button className="settings-switch on" onClick={() => toggle(p.id, p.name, false)}>
                    On
                  </button>
                </div>
              ))}
              {extraReady.map((id) => (
                <div key={id} className="settings-conn">
                  <span className="settings-conn-name">{nameMemo[id] ?? id}</span>
                  <span className="settings-conn-meta muted">ready</span>
                  <button className="settings-switch on" onClick={() => toggle(id, nameMemo[id] ?? id, false)}>
                    On
                  </button>
                </div>
              ))}
              {disabled.map((id) => (
                <div key={id} className="settings-conn off">
                  <span className="settings-conn-name">{nameByID.get(id) ?? nameMemo[id] ?? id}</span>
                  <span className="settings-conn-meta muted">disabled</span>
                  <button
                    className="settings-switch"
                    onClick={() => toggle(id, nameByID.get(id) ?? nameMemo[id] ?? id, true)}
                  >
                    Off
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="settings-section">
            <h3>Connect a provider</h3>
            <p className="settings-hint muted">
              Add a hosted provider with an API key (OpenAI, Anthropic, Groq...). The key is stored on the engine.
            </p>
            <div className="row settings-row">
              <select value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose a provider</option>
                {keyProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {connected.has(p.id) ? " · connected" : ""}
                  </option>
                ))}
              </select>
              <input
                type="password"
                placeholder={pick && connected.has(pick) ? "Replace key" : "API key"}
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
                  setNotice(`Connected ${name}.`)
                  setPick("")
                  setKey("")
                  await load()
                }}
              >
                Connect
              </button>
            </div>
          </section>

          {needsSetup.length > 0 && (
            <section className="settings-section">
              <h3>Needs setup</h3>
              <p className="settings-hint muted">
                Vertex and Bedrock sign in from the server (gcloud ADC / AWS), not an API key. Set the project or region,
                sign in on the server, then Enable to verify — until a live check passes they stay out of the model
                picker so you can't pick a provider that will fail on the first call.
              </p>
              {needsSetup.map((p) => {
                const spec = CLOUD_SETUPS.find((c) => c.id === p.id)
                return (
                  <div key={p.id} className="settings-needs">
                    <div className="row settings-row">
                      <span className="settings-conn-name">{p.name}</span>
                      <span className="settings-conn-meta muted">
                        {p.id === "google-vertex"
                          ? "Server sign-in: gcloud auth application-default login"
                          : "Server sign-in: configure AWS credentials (profile or role)"}
                      </span>
                    </div>
                    {spec && (
                      <CloudSetup
                        spec={spec}
                        onSave={async (options) => {
                          await setProviderOptions(p.id, options)
                          setNotice(`Saved ${p.name} project/region.`)
                          await load()
                        }}
                      />
                    )}
                    <div className="row settings-row">
                      <button className="primary" disabled={probing === p.id} onClick={() => enable(p)}>
                        {probing === p.id ? "Verifying..." : "Enable"}
                      </button>
                      {probeErr[p.id] && <span className="settings-conn-meta muted">{probeErr[p.id]}</span>}
                    </div>
                  </div>
                )
              })}
            </section>
          )}

          <LocalEndpoint
            onAdd={async (input) => {
              await addLocalProvider(input)
              setNotice(`Added ${input.name}. Restart the engine if its models don't appear.`)
              await load()
            }}
          />
        </div>
      </div>
    </div>
  )
}

// Plain-language note on where a ready provider's credentials came from. Env
// providers (Vertex, Bedrock) expose no auth method — their key is read from the
// host sign-in rather than typed here.
function statusLabel(provider: Provider, methods: Methods) {
  const m = methods[provider.id] ?? []
  if (m.some((x) => x.type === "api")) return "API key"
  if (m.some((x) => x.type === "oauth")) return "Signed in"
  return "Host credentials"
}

// The host-credential providers that still need a project/region to call. Each
// field maps to a provider.options key the engine reads (see provider.ts):
// google-vertex -> { project, location }, amazon-bedrock -> { region, profile }.
type CloudField = { key: string; label: string; placeholder: string; required: boolean; fallback?: string }
type CloudSpec = { id: string; name: string; fields: CloudField[] }
const CLOUD_SETUPS: CloudSpec[] = [
  {
    id: "google-vertex",
    name: "Google Vertex",
    fields: [
      { key: "project", label: "GCP project id", placeholder: "my-gcp-project", required: true },
      { key: "location", label: "Location", placeholder: "global", required: false, fallback: "global" },
    ],
  },
  {
    id: "amazon-bedrock",
    name: "Amazon Bedrock",
    fields: [
      { key: "region", label: "AWS region", placeholder: "us-east-1", required: true, fallback: "us-east-1" },
      { key: "profile", label: "AWS profile (optional)", placeholder: "default", required: false },
    ],
  },
]

function CloudSetup({ spec, onSave }: { spec: CloudSpec; onSave: (options: Record<string, string>) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>({})
  // Prefill from whatever the engine already has saved so the fields show the
  // live config rather than resetting to blank each time Settings opens.
  useEffect(() => {
    getProviderOptions(spec.id).then((opts) =>
      setValues(Object.fromEntries(spec.fields.map((f) => [f.key, opts[f.key] ?? ""]))),
    )
  }, [spec])
  const ready = spec.fields.filter((f) => f.required).every((f) => values[f.key]?.trim())
  return (
    <div className="settings-grid" style={{ marginTop: 12 }}>
      <label className="settings-label">{spec.name}</label>
      <span className="muted" style={{ fontSize: 12 }}>
        Reads from this host's {spec.id === "google-vertex" ? "gcloud ADC" : "AWS credentials"}.
      </span>
      {spec.fields.map((f) => (
        <input
          key={f.key}
          placeholder={f.placeholder}
          value={values[f.key] ?? ""}
          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
        />
      ))}
      <button
        className="primary settings-add"
        disabled={!ready}
        onClick={() =>
          onSave(
            // Drop blanks so an unset optional field falls back to the engine
            // default (location -> global, region -> us-east-1) rather than ""
            Object.fromEntries(
              spec.fields
                .map((f) => [f.key, (values[f.key]?.trim() || f.fallback) ?? ""])
                .filter(([, v]) => v),
            ),
          )
        }
      >
        Save
      </button>
    </div>
  )
}

function LocalEndpoint({
  onAdd,
}: {
  onAdd: (input: { id: string; name: string; baseURL: string; modelID: string }) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [baseURL, setBaseURL] = useState("http://localhost:1234/v1")
  const [modelID, setModelID] = useState("")
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")
  const ready = name.trim() && baseURL.trim() && modelID.trim()
  return (
    <section className="settings-section">
      <h3>Local endpoint</h3>
      <p className="settings-hint muted">
        OpenAI-compatible servers — LM Studio, Ollama, vLLM. The URL must be reachable from the machine running the
        engine, not the browser.
      </p>
      <div className="settings-grid">
        <label className="settings-label">Name</label>
        <input placeholder="LM Studio" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="settings-label">Base URL</label>
        <input placeholder="http://localhost:1234/v1" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} />
        <label className="settings-label">Model id</label>
        <input placeholder="llama-3.1-8b" value={modelID} onChange={(e) => setModelID(e.target.value)} />
        <button
          className="primary settings-add"
          disabled={!ready}
          onClick={async () => {
            await onAdd({ id, name: name.trim(), baseURL: baseURL.trim(), modelID: modelID.trim() })
            setName("")
            setModelID("")
          }}
        >
          Add provider
        </button>
      </div>
    </section>
  )
}
