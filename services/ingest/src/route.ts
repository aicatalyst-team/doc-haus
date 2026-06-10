import { createVertex } from "@ai-sdk/google-vertex"
import { generateObject } from "ai"

// Cheap routing call for the chat's "Auto" assistant: a fast Gemini model reads
// the lawyer's message (plus a little history) and picks which real assistant
// should answer it. Constrained to the candidate names so the model can only
// return one of them — never free text, never an invented agent.

export type Candidate = { name: string; description: string }
export type RouteRequest = {
  text: string
  history: string[]
  candidates: Candidate[]
  model: string
  project?: string
  location?: string
}

export async function routeAssistant(req: RouteRequest): Promise<string> {
  // Vertex authenticates from the host's gcloud ADC. Project/location travel in
  // the request — the web app reads them off the engine config's provider options,
  // where Settings stores them (connecting Vertex in the UI sets no env vars), so
  // env is only a fallback for setups that export GOOGLE_VERTEX_* themselves.
  const vertex = createVertex({
    project: req.project ?? process.env.GOOGLE_VERTEX_PROJECT,
    location: req.location ?? process.env.GOOGLE_VERTEX_LOCATION ?? "global",
  })
  const names = req.candidates.map((c) => c.name)
  const result = await generateObject({
    model: vertex(req.model),
    output: "enum",
    enum: names,
    temperature: 0,
    prompt: buildPrompt(req),
    // Gemini Flash thinks by default, which pushes routing latency well past the
    // web app's timeout budget. A one-word classification needs no thinking.
    providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } },
  })
  return result.object
}

function buildPrompt(req: RouteRequest) {
  const candidates = req.candidates.map((c) => `- ${c.name}: ${c.description}`).join("\n")
  const history = req.history.length ? req.history.map((h) => `- ${h}`).join("\n") : "(none)"
  return [
    "<role>",
    "You are a router for a legal-document assistant. Pick the single assistant best suited to answer the user's current message. Return only the assistant's name.",
    "Choose by what the user wants done now, not by the conversation's topic: a request to change, update, or rewrite document text is an editing task even if every earlier turn was a question.",
    "</role>",
    "<assistants>",
    candidates,
    "</assistants>",
    "<history>",
    history,
    "</history>",
    "<message>",
    req.text,
    "</message>",
  ].join("\n")
}
