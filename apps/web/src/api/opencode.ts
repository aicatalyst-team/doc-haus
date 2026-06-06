import { createOpencodeClient } from "@opencode-ai/sdk"
import type { Event, Part } from "@opencode-ai/sdk"
import { OPENCODE_URL } from "../config"

// One OpenCode client per matter. The matter's directory is sent as the
// x-opencode-directory header on every request, so every session and every
// tool (including search-document) is scoped to that matter's files + DB.
export function matterClient(directory: string) {
  return createOpencodeClient({ baseUrl: OPENCODE_URL, directory })
}

export type Client = ReturnType<typeof matterClient>

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

// Fire a prompt to a named agent. Resolves when the assistant turn completes;
// live progress arrives separately through subscribeEvents.
export async function sendPrompt(client: Client, sessionID: string, agent: string, text: string) {
  return client.session.prompt({
    path: { id: sessionID },
    body: { agent, parts: [{ type: "text", text }] },
  })
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
