import { createOpencodeClient } from "@opencode-ai/sdk"
import type { Config, Event, Part } from "@opencode-ai/sdk"
import { OPENCODE_URL } from "../config"

// One OpenCode client per matter. The matter's directory is sent as the
// x-opencode-directory header on every request, so every session and every
// tool (including search-document) is scoped to that matter's files + DB.
export function matterClient(directory: string) {
  return createOpencodeClient({ baseUrl: OPENCODE_URL, directory })
}

export type Client = ReturnType<typeof matterClient>

// A client with no matter directory. Settings act on the engine's global config
// (opencode.json) and machine-wide credential store (auth.json) rather than a
// single matter, so we deliberately omit the x-opencode-directory header.
export function settingsClient() {
  return createOpencodeClient({ baseUrl: OPENCODE_URL })
}

// All providers the engine knows from the models.dev catalog, with which ones
// are connected and the current default model per provider.
export async function listProviders(client: Client) {
  const res = await client.provider.list()
  return res.data ?? { all: [], default: {}, connected: [] }
}

// Per-provider auth methods (api key vs oauth). Empty array => credentials come
// from the environment (Vertex ADC, Bedrock/Azure SDK creds), not a key field.
export async function listAuthMethods(client: Client) {
  const res = await client.provider.auth()
  return res.data ?? {}
}

// Store an API key for a provider. Writes to the engine's auth.json (0o600).
export async function setProviderKey(client: Client, id: string, key: string) {
  return client.auth.set({ path: { id }, body: { type: "api", key } })
}

// Engine-wide config lives behind /global/config (the engine's getGlobal/
// updateGlobal), which round-trips through ~/.config/opencode. The SDK's
// client.config.* targets the per-matter /config instead: its PATCH writes a
// <cwd>/config.json that the engine never reads back, so settings saved there
// silently vanish on reload. Settings are engine-wide, so we hit /global/config
// directly — the SDK exposes no typed method for it.
export async function getConfig() {
  const res = await fetch(`${OPENCODE_URL}/global/config`)
  if (!res.ok) throw new Error(`Failed to load config (${res.status})`)
  return (await res.json()) as Config
}

async function patchConfig(patch: Config) {
  const res = await fetch(`${OPENCODE_URL}/global/config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`Failed to save config (${res.status})`)
  return (await res.json()) as Config
}

// Set the engine-wide default model, as a "providerID/modelID" string.
export async function setDefaultModel(model: string) {
  return patchConfig({ model })
}

// Hide providers from routing entirely. A disabled provider drops out of the
// catalog, the model picker, and any agent that would route to it.
export async function setDisabledProviders(ids: string[]) {
  return patchConfig({ disabled_providers: ids })
}

// Register a local OpenAI-compatible provider (LM Studio, Ollama, vLLM...). The
// engine loads it through @ai-sdk/openai-compatible at the given baseURL. The
// baseURL must be reachable from where `opencode serve` runs, not the browser.
export async function addLocalProvider(input: { id: string; name: string; baseURL: string; modelID: string }) {
  const cfg = await getConfig()
  return patchConfig({
    provider: {
      ...(cfg.provider ?? {}),
      [input.id]: {
        npm: "@ai-sdk/openai-compatible",
        name: input.name,
        options: { baseURL: input.baseURL },
        models: { [input.modelID]: { name: input.modelID } },
      },
    },
  })
}

// Shape returned by the search-document tool in its part metadata.citations.
export type Citation = {
  documentName: string
  docPath: string
  section: string
  excerpt: string
  charStart: number
  charEnd: number
  score: number
}

export async function listAgents(client: Client) {
  const res = await client.app.agents()
  return res.data ?? []
}

export async function createSession(client: Client, title: string) {
  const res = await client.session.create({ body: { title } })
  if (!res.data) throw new Error("Failed to create session")
  return res.data
}

// Every session the engine holds for this matter (scoped by the client's
// directory header). Subagent runs carry a parentID; top-level chats do not.
export async function listSessions(client: Client) {
  const res = await client.session.list()
  return res.data ?? []
}

// Delete a session and its messages from the engine. Irreversible.
export async function deleteSession(client: Client, sessionID: string) {
  return client.session.delete({ path: { id: sessionID } })
}

// Settled messages for one session, each as { info, parts }, used to replay a
// past conversation back into the chat panel.
export async function getMessages(client: Client, sessionID: string) {
  const res = await client.session.messages({ path: { id: sessionID } })
  return res.data ?? []
}

// Fire a prompt to a named agent. Resolves when the assistant turn completes;
// live progress arrives separately through subscribeEvents.
export async function sendPrompt(client: Client, sessionID: string, agent: string, text: string) {
  return client.session.prompt({
    path: { id: sessionID },
    body: { agent, parts: [{ type: "text", text }] },
  })
}

// Revert a user message and everything after it, rolling the session back to
// just before that turn. Used by edit/retry: revert, then send the new prompt
// so the assistant answer is regenerated from the edited question.
export async function revertMessage(client: Client, sessionID: string, messageID: string) {
  return client.session.revert({ path: { id: sessionID }, body: { messageID } })
}

// Subscribe to the server event stream and invoke onEvent for each event.
// Caller passes an AbortSignal to stop. Errors after abort are swallowed.
export async function subscribeEvents(client: Client, onEvent: (e: Event) => void, signal: AbortSignal) {
  const res = await client.event.subscribe()
  for await (const event of res.stream) {
    if (signal.aborted) return
    onEvent(event as Event)
  }
}

export function isToolPart(part: Part): part is Extract<Part, { type: "tool" }> {
  return part.type === "tool"
}

export function isTextPart(part: Part): part is Extract<Part, { type: "text" }> {
  return part.type === "text"
}
