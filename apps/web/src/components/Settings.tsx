import { useEffect, useMemo, useState } from "react"
import {
  addLocalProvider,
  getConfig,
  listAuthMethods,
  listProviders,
  setDefaultModel,
  setDisabledProviders,
  setProviderKey,
  settingsClient,
  type Client,
} from "../api/opencode"

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
  const [model, setModel] = useState("")
  const [disabled, setDisabled] = useState<string[]>([])
  const [notice, setNotice] = useState("")

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
  // the engine expects, for the default-model picker.
  const models = connectedProviders.flatMap((p) =>
    Object.values(p.models).map((m) => ({ value: `${p.id}/${m.id}`, label: `${p.name} — ${m.name}` })),
  )

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
            <h3>Default model</h3>
            <p className="settings-hint muted">Used for every matter unless an assistant pins its own model.</p>
            <div className="row settings-row">
              <select value={model} onChange={(e) => setModel(e.target.value)} disabled={models.length === 0}>
                <option value="">{models.length ? "Select a model" : "Connect a provider first"}</option>
                {models.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <button
                className="primary"
                disabled={!model}
                onClick={async () => {
                  await setDefaultModel(model)
                  // On first run, picking a model is the whole point of the modal —
                  // close once it's saved so the user lands straight in the app.
                  if (firstRun) return onClose()
                  setNotice(`Default model set to ${model}.`)
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
              {connectedProviders.length === 0 && disabled.length === 0 && (
                <span className="muted">None detected yet. Connect one below.</span>
              )}
              {connectedProviders.map((p) => (
                <div key={p.id} className="settings-conn">
                  <span className="settings-conn-name">{p.name}</span>
                  <span className="settings-conn-meta muted">
                    {statusLabel(p, methods)} · {Object.keys(p.models).length} models
                  </span>
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
