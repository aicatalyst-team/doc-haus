import { useEffect, useMemo, useRef, useState } from "react"
import type { Event, Part } from "@opencode-ai/sdk"
import {
  createSession,
  getMessages,
  matterClient,
  revertMessage,
  sendPrompt,
  subscribeEvents,
  type Citation,
  type Client,
} from "../api/opencode"
import CitationView from "./CitationView"
import Markdown from "./Markdown"
import ModelSelector from "./ModelSelector"
import WorkflowLauncher from "./WorkflowLauncher"

// One row in the assistant's reasoning timeline: a thinking block or a tool call.
type Step =
  | { kind: "reasoning"; text: string; done: boolean }
  | { kind: "tool"; label: string; status: "running" | "done" | "error" }

// id is the server message id, carried on user turns so edit/retry can revert
// the session back to that exact message. Optimistic turns added before a
// finalize reload have no id, so their actions stay hidden until settled.
type Turn = { role: "user" | "assistant"; text: string; citations: Citation[]; steps: Step[]; id?: string }

// Quiet starter prompts so a fresh matter is not a blank box — mirrors how Harvey
// and Legora seat the lawyer with ready questions about the documents in scope.
const STARTERS = [
  "What are the key obligations of each party?",
  "What termination rights does each party have?",
  "Flag any unusual or one-sided clauses.",
]

// Reduce a message's parts to its visible text + any search-document citations.
function contentOf(parts: Part[]) {
  const text = parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("")
  const citations = parts
    .filter((p): p is Extract<Part, { type: "tool" }> => p.type === "tool")
    .filter((p) => p.tool === "search-document" && p.state.status === "completed")
    .flatMap((p) => ((p.state as { metadata?: { citations?: Citation[] } }).metadata?.citations ?? []))
  return { text, citations }
}

// Turn the ordered parts into the visible reasoning timeline: each thinking
// block and each tool call becomes a step, in arrival order. The final answer
// text and citations are handled by contentOf — these are the intermediate work.
function partsToSteps(parts: Part[]): Step[] {
  return parts.flatMap((p): Step[] => {
    if (p.type === "reasoning")
      return p.text.trim() ? [{ kind: "reasoning", text: p.text, done: Boolean(p.time.end) }] : []
    if (p.type === "tool") {
      const status = p.state.status === "completed" ? "done" : p.state.status === "error" ? "error" : "running"
      const titled = p.state.status === "completed" || p.state.status === "running" ? p.state.title : undefined
      return [{ kind: "tool", label: titled ?? humanizeTool(p.tool), status }]
    }
    return []
  })
}

function humanizeTool(tool: string) {
  return tool.charAt(0).toUpperCase() + tool.slice(1).replace(/-/g, " ")
}

function IconPencil() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  )
}

function IconRetry() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  )
}

// Aggregate every assistant part received this turn. A tool-using turn produces
// several assistant messages (one per model step), so tracking only the latest
// id would blank the preview to "Thinking..." between steps and drop earlier
// steps on finalize. Reading all assistant-role parts keeps the live view and
// the saved turn whole.
function readTurn(parts: Map<string, Part>, roles: Map<string, string>) {
  const assistant = [...parts.values()].filter((p) => roles.get(p.messageID) === "assistant")
  return { ...contentOf(assistant), steps: partsToSteps(assistant) }
}

// Group stored messages into turns. A tool-using turn spans several consecutive
// assistant messages (one per model step); merging their parts reconstructs the
// whole reasoning timeline instead of showing only the final answer bubble.
function toTurns(msgs: { info: { id: string; role: "user" | "assistant" }; parts: Part[] }[]): Turn[] {
  const groups: { role: "user" | "assistant"; id: string; parts: Part[] }[] = []
  for (const m of msgs) {
    const last = groups[groups.length - 1]
    if (last && last.role === "assistant" && m.info.role === "assistant") last.parts.push(...m.parts)
    else groups.push({ role: m.info.role, id: m.info.id, parts: [...m.parts] })
  }
  return groups
    .map((g) => ({
      role: g.role,
      id: g.id,
      ...contentOf(g.parts),
      steps: g.role === "assistant" ? partsToSteps(g.parts) : [],
    }))
    .filter((t) => t.text || t.citations.length || t.steps.length)
}

// A session title from the first message: trimmed to a word boundary with an
// ellipsis, so the rail reads cleanly instead of cutting mid-word.
function titleFrom(text: string) {
  if (text.length <= 60) return text
  const cut = text.slice(0, 60)
  const space = cut.lastIndexOf(" ")
  return (space > 30 ? cut.slice(0, space) : cut).trimEnd() + "…"
}

export default function ChatPanel({
  directory,
  sessionID,
  agent,
  available,
  onAgentChange,
  onLaunchWorkflow,
}: {
  directory: string
  sessionID?: string
  agent: string
  available: Set<string>
  onAgentChange: (name: string) => void
  onLaunchWorkflow?: (name: string) => void
}) {
  const client = useMemo<Client>(() => matterClient(directory), [directory])
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ index: number; draft: string } | null>(null)
  const [, bump] = useState(0)

  const sessionRef = useRef<string>("")
  const partsRef = useRef<Map<string, Part>>(new Map())
  const rolesRef = useRef<Map<string, string>>(new Map())
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    if (sessionID) {
      sessionRef.current = sessionID
      getMessages(client, sessionID).then((msgs) => setTurns(toTurns(msgs)))
    }
    // No session until the first send (see onSend) — mounting the panel must not
    // mint an empty throwaway session that would clutter the conversation list.
    subscribeEvents(client, onEvent, controller.signal).catch(() => {})
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, sessionID])

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  })

  function onEvent(event: Event) {
    if (event.type === "message.updated") {
      const info = event.properties.info
      if (info.sessionID !== sessionRef.current) return
      rolesRef.current.set(info.id, info.role)
      bump((n) => n + 1)
      return
    }
    if (event.type === "message.part.updated") {
      const part = event.properties.part
      if (part.sessionID !== sessionRef.current) return
      partsRef.current.set(part.id, part)
      bump((n) => n + 1)
      return
    }
    if (event.type === "session.idle" && event.properties.sessionID === sessionRef.current) {
      finalize()
    }
  }

  // Reload the settled history from the server rather than appending the
  // in-flight turn from refs. The reload gives every turn its authoritative
  // message id, which edit/retry need to revert the session to a given turn.
  async function finalize() {
    if (sessionRef.current) setTurns(toTurns(await getMessages(client, sessionRef.current)))
    partsRef.current.clear()
    rolesRef.current.clear()
    setBusy(false)
  }

  async function onSend() {
    const text = input.trim()
    if (!text || busy) return
    setTurns((prev) => [...prev, { role: "user", text, citations: [], steps: [] }])
    setInput("")
    setBusy(true)
    partsRef.current.clear()
    rolesRef.current.clear()
    // Create the session lazily, titled from this first message so it reads as a
    // distinct conversation in the rail rather than an interchangeable "Q&A".
    if (!sessionRef.current) sessionRef.current = (await createSession(client, titleFrom(text))).id
    await sendPrompt(client, sessionRef.current, agent, text)
  }

  // Edit and retry both rewind the session to a user turn and re-ask: revert
  // drops that message and everything after it server-side, then we re-send the
  // (possibly edited) prompt so the assistant answer is regenerated. The UI is
  // truncated to before the turn optimistically; finalize reloads the truth.
  async function resendFrom(turn: Turn, index: number, text: string) {
    if (!turn.id || !text.trim() || busy) return
    setEditing(null)
    setBusy(true)
    partsRef.current.clear()
    rolesRef.current.clear()
    setTurns((prev) => [...prev.slice(0, index), { role: "user", text, citations: [], steps: [] }])
    await revertMessage(client, sessionRef.current, turn.id)
    await sendPrompt(client, sessionRef.current, agent, text)
  }

  const live = readTurn(partsRef.current, rolesRef.current)

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Ask the matter</h2>
        <ModelSelector available={available} value={agent} onChange={onAgentChange} />
      </div>
      <div className="chat-log" ref={logRef}>
        {turns.length === 0 && !busy && (
          <div className="chat-empty">
            <p className="muted">Ask a question about this matter's documents. Every answer cites the source section.</p>
            <div className="starters">
              {STARTERS.map((s) => (
                <button key={s} className="starter" onClick={() => setInput(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="msg user">
              {editing?.index === i ? (
                <div className="msg-edit">
                  <textarea
                    autoFocus
                    value={editing.draft}
                    onChange={(e) => setEditing({ index: i, draft: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) resendFrom(t, i, editing.draft)
                      if (e.key === "Escape") setEditing(null)
                    }}
                  />
                  <div className="msg-edit-actions">
                    <button className="icon-btn" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                    <button className="primary" onClick={() => resendFrom(t, i, editing.draft)}>
                      Save & send
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {t.text}
                  {t.id && !busy && (
                    <div className="msg-actions">
                      <button
                        className="icon-btn"
                        title="Edit message"
                        onClick={() => setEditing({ index: i, draft: t.text })}
                      >
                        <IconPencil />
                      </button>
                      <button className="icon-btn" title="Retry" onClick={() => resendFrom(t, i, t.text)}>
                        <IconRetry />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div key={i} className="msg assistant">
              <StepsPanel steps={t.steps} busy={false} />
              {t.text && <Markdown>{t.text}</Markdown>}
              <CitationView citations={t.citations} />
            </div>
          ),
        )}
        {busy && (
          <div className="msg assistant">
            <StepsPanel steps={live.steps} busy />
            {live.text ? (
              <Markdown>{live.text}</Markdown>
            ) : (
              live.steps.length === 0 && <span className="muted">Thinking...</span>
            )}
            <CitationView citations={live.citations} />
          </div>
        )}
      </div>
      {onLaunchWorkflow && (
        <div className="composer-tools">
          <WorkflowLauncher available={available} onLaunch={onLaunchWorkflow} />
        </div>
      )}
      <div className="composer">
        <textarea
          placeholder="e.g. What termination rights does each party have?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSend()
          }}
        />
        <button className="primary" onClick={onSend} disabled={busy || !input.trim()}>
          Send
        </button>
      </div>
      <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
        Cmd/Ctrl + Enter to send. Answers cite [Document § section] from indexed documents.
      </p>
    </div>
  )
}

// The reasoning timeline: a collapsible panel of thinking blocks and tool calls,
// each on a dotted timeline. Open while the turn runs; collapsed once answered.
function StepsPanel({ steps, busy }: { steps: Step[]; busy: boolean }) {
  if (steps.length === 0) return null
  return (
    <details className="steps" open={busy}>
      <summary>{busy ? "Working..." : "Steps"}</summary>
      <ol className="step-list">
        {steps.map((s, i) =>
          s.kind === "tool" ? (
            <li key={i} className="step">
              <span className={`dot ${s.status}`} />
              <span className="step-label">{s.label}</span>
            </li>
          ) : (
            <li key={i} className="step">
              <span className="dot reasoning" />
              <details className="thinking" open={busy && i === steps.length - 1 && !s.done}>
                <summary>Thought process</summary>
                <Markdown>{s.text}</Markdown>
              </details>
            </li>
          ),
        )}
      </ol>
    </details>
  )
}
