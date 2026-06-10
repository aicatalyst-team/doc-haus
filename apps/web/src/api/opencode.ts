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

// Vertex (project/location) and Bedrock (region/profile) take their settings from
// provider.options in the engine's config, falling back to env only when unset
// (see packages/opencode/src/provider/provider.ts). Setting them here means a
// fresh clone connects these host-credential providers entirely from the UI —
// no GOOGLE_VERTEX_PROJECT / AWS_REGION env needed. Merge into any existing entry
// so a key set elsewhere on the same provider is preserved.
export async function setProviderOptions(id: string, options: Record<string, string>) {
  const cfg = await getConfig()
  const existing = cfg.provider?.[id] ?? {}
  return patchConfig({
    provider: {
      ...(cfg.provider ?? {}),
      [id]: { ...existing, options: { ...(existing.options ?? {}), ...options } },
    },
  })
}

// The currently-saved provider.options, so the cloud-setup fields prefill with
// what the engine is actually using rather than starting blank on every open.
export async function getProviderOptions(id: string) {
  const cfg = await getConfig()
  return (cfg.provider?.[id]?.options ?? {}) as Record<string, string | undefined>
}

// A pending permission request from the engine. The edit tools (word-integration,
// tracked-changes, redline) call ctx.ask before mutating or proposing against a
// document; the engine parks the tool call and emits a permission.asked event,
// then resumes (or fails) it when we reply. metadata carries what the tool is
// about to do (document, find/replace or clause/replacement) for display.
export type PermissionRequest = {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool?: { messageID: string; callID: string }
}

export type PermissionReply = "once" | "always" | "reject"

// The permission events the engine emits on the same SSE stream as everything
// else. The v1 SDK's Event union does not model them, so the subscriber narrows
// raw events through this type (see ChatPanel.onEvent).
export type PermissionEvent =
  | { type: "permission.asked"; properties: PermissionRequest }
  | { type: "permission.replied"; properties: { sessionID: string; requestID: string; reply: PermissionReply } }

// Permission state is instance-scoped, so both calls must carry the matter's
// x-opencode-directory header. The v1 SDK exposes no permission methods — its
// generated client predates the /permission routes — so these hit them directly.
export async function listPermissions(directory: string) {
  const res = await fetch(`${OPENCODE_URL}/permission`, {
    headers: { "x-opencode-directory": directory },
  })
  if (!res.ok) throw new Error(`Failed to list permissions (${res.status})`)
  return (await res.json()) as PermissionRequest[]
}

export async function replyPermission(directory: string, requestID: string, reply: PermissionReply) {
  const res = await fetch(`${OPENCODE_URL}/permission/${requestID}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-opencode-directory": directory },
    body: JSON.stringify({ reply }),
  })
  if (!res.ok) throw new Error(`Failed to reply to permission (${res.status})`)
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
//
// The stream is a single long-lived SSE connection. A network blip or a long
// idle gap (a heavy model thinking phase emits no parts for a while) can end it,
// and without reconnecting the live view would silently stop updating — missing
// the rest of the turn and its session.idle, so the turn appears stuck until a
// manual reload. So loop: resubscribe whenever the stream ends, and fire
// onReconnect on each re-subscribe so the caller can resync the state it missed.
export async function subscribeEvents(
  client: Client,
  onEvent: (e: Event) => void,
  signal: AbortSignal,
  onReconnect?: () => void,
) {
  let first = true
  while (!signal.aborted) {
    try {
      const res = await client.event.subscribe()
      if (!first) onReconnect?.()
      first = false
      for await (const event of res.stream) {
        if (signal.aborted) return
        onEvent(event as Event)
      }
    } catch {
      if (signal.aborted) return
    }
    if (signal.aborted) return
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

export function isToolPart(part: Part): part is Extract<Part, { type: "tool" }> {
  return part.type === "tool"
}

export function isTextPart(part: Part): part is Extract<Part, { type: "text" }> {
  return part.type === "text"
}
