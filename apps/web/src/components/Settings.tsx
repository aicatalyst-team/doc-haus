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
import { defaultProvider, pickForProvider, probeModel, providerOf } from "../models"
import { listAwsProfiles, listGcpProjects, probeVertexHost } from "../api/ingest"
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

  // Save the card's project/region to every provider it covers, then probe each
  // one's credentials with one real call; each that passes is marked verified
  // (persisted) and joins the picker, each that fails keeps its own error and
  // stays gated — so one Vertex card can verify Gemini while Claude (a separate
  // provider id on the same project) still needs model access enabled. The probe
  // model must be the curated one — the first id in the merged Vertex catalog is
  // a Claude-on-Vertex model that hits a different endpoint and 400s even when
  // the Gemini setup is correct.
  async function enable(targets: Provider[], options?: Record<string, string>) {
    setProbing(targets[0].id)
    setProbeErr((e) => ({ ...e, ...Object.fromEntries(targets.map((p) => [p.id, ""])) }))
    // Sequential: setProviderOptions does a read-merge-write of the whole
    // provider map, so concurrent saves would drop each other's entry.
    // Claude-on-Vertex needs the endpoint spelled out: its SDK builds the host
    // as "{location}-aiplatform.googleapis.com", which is wrong for "global"
    // (the global endpoint has no location prefix), so the probe hangs on a
    // bogus host instead of failing with a real credential/quota error.
    const optionsFor = (id: string) =>
      id === "google-vertex-anthropic" && options?.project
        ? { ...options, baseURL: vertexAnthropicBaseURL(options.project, options.location || "global") }
        : options
    if (options && Object.keys(options).length) for (const p of targets) await setProviderOptions(p.id, optionsFor(p.id)!)
    const results = await Promise.all(
      targets.map(async (p) => {
        const modelID = probeModel(p.id, Object.keys(p.models))
        if (!modelID) return { p, ok: false as const, error: "Provider has no models to test." }
        // Vertex verifies via the ingest host probe — one direct REST call with
        // the host's ADC — because prompting through the engine's header-less
        // settings client cold-boots a second instance and times out.
        const vertex = p.id === "google-vertex" || p.id === "google-vertex-anthropic"
        const result =
          vertex && options?.project
            ? await probeVertexHost({
                project: options.project,
                location: options.location || "global",
                publisher: p.id === "google-vertex" ? "google" : "anthropic",
                model: modelID,
              })
            : await probeProvider(client, p.id, modelID)
        if (!result.ok) return { p, ok: false as const, error: result.error || "Verification failed." }
        return { p, ok: true as const, error: "" }
      }),
    )
    setProbing("")
    setProbeErr((e) => ({ ...e, ...Object.fromEntries(results.map((r) => [r.p.id, r.error])) }))
    const passed = results.filter((r) => r.ok)
    if (!passed.length) return
    setVerified((prev) => {
      const next = new Set(prev)
      passed.forEach((r) => next.add(r.p.id))
      saveVerified(next)
      return next
    })
    setNotice(`${passed.map((r) => r.p.name).join(", ")} verified.`)
    await load()
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

          {needsSetup.length > 0 && (
            <section className="settings-section">
              <h3>Needs setup</h3>
              <p className="settings-hint muted">
                Vertex and Bedrock sign in from the server (gcloud ADC / AWS), not an API key. Set the project or region,
                sign in on the server, then Enable to verify — until a live check passes they stay out of the model
                picker so you can't pick a provider that will fail on the first call.
              </p>
              {CLOUD_SETUPS.map((spec) => {
                const pending = needsSetup.filter((p) => spec.ids.includes(p.id))
                if (!pending.length) return null
                return (
                  <NeedsSetupCard
                    key={spec.ids[0]}
                    spec={spec}
                    providers={pending}
                    probing={pending.some((p) => probing === p.id)}
                    errors={probeErr}
                    onEnable={(options) => enable(pending, options)}
                  />
                )
              })}
            </section>
          )}

          <section className="settings-section">
            <h3>Add a provider — API key</h3>
            <p className="settings-hint muted">
              A hosted provider you connect with an API key (OpenAI, Anthropic, Groq...). The key is stored on the
              engine. Vertex and Bedrock instead sign in on the server — see Needs setup above.
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

          <section className="settings-section">
            <h3>Choose models</h3>
            <p className="settings-hint muted">
              Once a provider is ready above, pick a default and a fast model from it — both stay on the one provider, so
              the Auto router (which runs the fast model) can never call across clouds.
            </p>
            <div className="row settings-row">
              <span className="muted">Provider</span>
              <select value={provider} onChange={(e) => changeProvider(e.target.value)} disabled={models.length === 0}>
                <option value="">{models.length ? "Select a provider" : "Add a provider first"}</option>
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

// The host-credential setups that still need a project/region to call. One card
// can cover several provider ids that share the same credentials and settings —
// Gemini (google-vertex) and Claude (google-vertex-anthropic) are separate
// provider ids but the same GCP project and gcloud sign-in, so they get one
// card. Each field maps to a provider.options key the engine reads (see
// provider.ts): vertex -> { project, location }, bedrock -> { region, profile }.
// A field is either a select over a fixed list (locations/regions, defaulting
// via fallback), or an input whose suggestions come from what the host's
// sign-in can actually see (GCP projects, AWS profiles) — still typeable, since
// the host may have no sign-in to enumerate yet.
type CloudField = {
  key: string
  label: string
  placeholder: string
  required: boolean
  fallback?: string
  options?: string[]
  suggest?: "gcp-projects" | "aws-profiles"
}
type CloudSpec = { ids: string[]; name: string; signin: string; fields: CloudField[] }

// The Vertex endpoint for Anthropic publisher models, mirroring Google's
// scheme: regional locations prefix the host, "global" does not.
function vertexAnthropicBaseURL(project: string, location: string) {
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`
  return `https://${host}/v1/projects/${project}/locations/${location}/publishers/anthropic/models`
}

const VERTEX_LOCATIONS = [
  "global",
  "us-central1",
  "us-east1",
  "us-east4",
  "us-east5",
  "us-west1",
  "us-west4",
  "northamerica-northeast1",
  "southamerica-east1",
  "europe-west1",
  "europe-west2",
  "europe-west3",
  "europe-west4",
  "europe-west9",
  "europe-north1",
  "asia-east1",
  "asia-northeast1",
  "asia-northeast3",
  "asia-south1",
  "asia-southeast1",
  "australia-southeast1",
  "me-central1",
]

const BEDROCK_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-2",
  "ca-central-1",
  "sa-east-1",
  "eu-central-1",
  "eu-central-2",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-north-1",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-south-1",
  "ap-southeast-1",
  "ap-southeast-2",
]

const CLOUD_SETUPS: CloudSpec[] = [
  {
    ids: ["google-vertex", "google-vertex-anthropic"],
    name: "Google Vertex AI",
    signin: "gcloud auth application-default login",
    fields: [
      { key: "project", label: "GCP project id", placeholder: "my-gcp-project", required: true, suggest: "gcp-projects" },
      { key: "location", label: "Location", placeholder: "global", required: false, fallback: "global", options: VERTEX_LOCATIONS },
    ],
  },
  {
    ids: ["amazon-bedrock"],
    name: "Amazon Bedrock",
    signin: "aws configure (profile or role)",
    fields: [
      { key: "region", label: "AWS region", placeholder: "us-east-1", required: true, fallback: "us-east-1", options: BEDROCK_REGIONS },
      { key: "profile", label: "AWS profile", placeholder: "default", required: false, suggest: "aws-profiles" },
    ],
  },
]

// One card per cloud setup: the sign-in it expects on the server, labeled
// project/region fields shared by every provider the card covers, and a single
// Enable that saves the fields and runs the live probe in one go. The old split
// (Save here, Enable elsewhere) let you probe values you had typed but never
// saved. Per-provider results render under the button, so a card covering
// Gemini + Claude can pass one and keep the other pending with its error.
function NeedsSetupCard({
  spec,
  providers,
  probing,
  errors,
  onEnable,
}: {
  spec: CloudSpec
  providers: Provider[]
  probing: boolean
  errors: Record<string, string>
  onEnable: (options: Record<string, string>) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  // What the host's sign-in can see for suggest fields (GCP projects, AWS
  // profiles), keyed by field. Empty means nothing to suggest — type instead.
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({})
  // Prefill from whatever the engine already has saved (falling back to the
  // field default) so the fields show the live config rather than resetting to
  // blank each time Settings opens. The card's providers share their settings,
  // so the first id is the source.
  useEffect(() => {
    getProviderOptions(spec.ids[0]).then((opts) =>
      setValues(Object.fromEntries(spec.fields.map((f) => [f.key, opts[f.key] ?? f.fallback ?? ""]))),
    )
    spec.fields
      .filter((f) => f.suggest)
      .forEach((f) =>
        (f.suggest === "gcp-projects" ? listGcpProjects() : listAwsProfiles()).then((items) =>
          setSuggestions((s) => ({ ...s, [f.key]: items })),
        ),
      )
  }, [spec])
  const ready = spec.fields.every((f) => !f.required || values[f.key]?.trim() || f.fallback)
  const failed = providers.filter((p) => errors[p.id])
  return (
    <div className="settings-needs">
      <div className="row settings-row">
        <span className="settings-conn-name">{spec.name}</span>
        <span className="settings-conn-meta muted">Server sign-in: {spec.signin}</span>
      </div>
      {providers.length > 1 && (
        <span className="muted" style={{ fontSize: 12 }}>
          One check covers {providers.map((p) => p.name).join(" and ")}.
        </span>
      )}
      {spec.fields.map((f) => {
        const set = (value: string) => setValues((v) => ({ ...v, [f.key]: value }))
        const listID = `${spec.ids[0]}-${f.key}`
        return (
          <div key={f.key} className="row settings-row settings-field">
            <label className="settings-label settings-field-label">{f.label}</label>
            {f.options ? (
              <select value={values[f.key] ?? f.fallback ?? ""} onChange={(e) => set(e.target.value)}>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                placeholder={f.placeholder}
                value={values[f.key] ?? ""}
                list={suggestions[f.key]?.length ? listID : undefined}
                onChange={(e) => set(e.target.value)}
              />
            )}
            {(suggestions[f.key]?.length ?? 0) > 0 && (
              <datalist id={listID}>
                {suggestions[f.key]?.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            )}
          </div>
        )
      })}
      <div className="row settings-row settings-field">
        <button
          className="primary"
          disabled={probing || !ready}
          onClick={() =>
            onEnable(
              // Drop blanks so an unset optional field falls back to the engine
              // default (location -> global, region -> us-east-1) rather than ""
              Object.fromEntries(
                spec.fields.map((f) => [f.key, (values[f.key]?.trim() || f.fallback) ?? ""]).filter(([, v]) => v),
              ),
            )
          }
        >
          {probing ? "Verifying..." : "Enable"}
        </button>
      </div>
      {failed.map((p) => (
        <span key={p.id} className="settings-error">
          {providers.length > 1 ? `${p.name}: ${errors[p.id]}` : errors[p.id]}
        </span>
      ))}
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
