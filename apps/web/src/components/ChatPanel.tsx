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
import { WORKFLOWS } from "../agents"
import CitationView from "./CitationView"
import Markdown from "./Markdown"
import ModelSelector from "./ModelSelector"
import WorkflowLauncher from "./WorkflowLauncher"

// One row in the assistant's reasoning timeline: a thinking block or a tool call.
type Step =
  | { kind: "reasoning"; text: string; done: boolean }
  | { kind: "tool"; label: string; status: "running" | "done" | "error"; detail?: string; children?: Step[] }

// A redline/tracked-change a turn proposed: the clause delta plus a pointer back
// to the document, so the assistant bubble can preview the red/green change and
// link into the full tracked-changes review (see RedlineView, DocumentViewer).
type RedlineProposal = { id?: number; document: string; oldText: string; newText: string }

// id is the server message id, carried on user turns so edit/retry can revert
// the session back to that exact message. Optimistic turns added before a
// finalize reload have no id, so their actions stay hidden until settled.
// agent is the assistant that produced the turn — the server stamps it on the
// user message, so an assistant turn inherits the agent of the user turn it
// answered. Carried so mixed-agent threads read clearly (see agentLabel).
type Turn = {
  role: "user" | "assistant"
  text: string
  citations: Citation[]
  redlines: RedlineProposal[]
  steps: Step[]
  id?: string
  agent?: string
}

// Quiet starter prompts so a fresh matter is not a blank box — mirrors how Harvey
// and Legora seat the lawyer with ready questions about the documents in scope.
const STARTERS = [
  "What are the key obligations of each party?",
  "What termination rights does each party have?",
  "Flag any unusual or one-sided clauses.",
]

// Reduce a message's parts to its visible text, search-document citations, and
// any redline proposals.
function contentOf(parts: Part[]) {
  const text = parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("")
  const citations = parts
    .filter((p): p is Extract<Part, { type: "tool" }> => p.type === "tool")
    .filter((p) => p.tool === "search-document" && p.state.status === "completed")
    .flatMap((p) => ((p.state as { metadata?: { citations?: Citation[] } }).metadata?.citations ?? []))
  return { text, citations, redlines: redlinesOf(parts) }
}

// The redline and tracked-changes tools both record a pending proposal and return
// its delta in their metadata: tracked-changes as find/replace, redline as the
// located clause's old text and its replacement. Surface either as a uniform
// old/new proposal pointing at its document so the bubble can preview and link it.
function redlinesOf(parts: Part[]): RedlineProposal[] {
  return parts
    .filter((p): p is Extract<Part, { type: "tool" }> => p.type === "tool")
    .filter((p) => (p.tool === "redline" || p.tool === "tracked-changes") && p.state.status === "completed")
    .flatMap((p) => {
      const meta = (p.state as { metadata?: Record<string, unknown> }).metadata ?? {}
      const document = meta.document as string | undefined
      if (!document) return []
      const oldText = (p.tool === "redline" ? meta.oldText : meta.find) as string | undefined
      const newText = (p.tool === "redline" ? meta.replacement : meta.replace) as string | undefined
      return [{ id: meta.redline as number | undefined, document, oldText: oldText ?? "", newText: newText ?? "" }]
    })
}

// Turn the ordered parts into the visible reasoning timeline: each thinking
// block and each tool call becomes a step, in arrival order. The final answer
// text and citations are handled by contentOf — these are the intermediate work.
// `pool`, when given, is every part received this turn across the workflow and
// its subagent sessions. A task step then nests the steps of the subagent it
// spawned (linked by the child sessionId on the task part's metadata), so the
// reviewer's own thinking streams live beneath "Consulted the Reviewer" instead
// of the step sitting opaque while the child works.
function partsToSteps(parts: Part[], matter: string, pool?: Part[]): Step[] {
  return parts.flatMap((p): Step[] => {
    if (p.type === "reasoning")
      return p.text.trim() ? [{ kind: "reasoning", text: p.text, done: Boolean(p.time.end) }] : []
    if (p.type === "tool") {
      const status = p.state.status === "completed" ? "done" : p.state.status === "error" ? "error" : "running"
      const childID =
        pool && p.tool === "task"
          ? ((p.state as { metadata?: { sessionId?: string } }).metadata?.sessionId ?? undefined)
          : undefined
      const childParts = childID
        ? pool!.filter((c) => c.sessionID === childID && (c.type === "reasoning" || c.type === "tool"))
        : []
      const children = childParts.length ? partsToSteps(childParts, matter, pool) : undefined
      // The tool's own output (or error) — surfaced behind a disclosure so the
      // timeline stays a one-line narration but the underlying work it explored
      // (a search's passages, a read's content, a failure's reason) is one click
      // away. Subagent task steps narrate through their nested children instead.
      const raw =
        p.state.status === "completed" ? p.state.output : p.state.status === "error" ? p.state.error : undefined
      const detail = !children && raw?.trim() ? raw.trim() : undefined
      return [{ kind: "tool", label: stepLabel(p, matter), status, detail, children }]
    }
    return []
  })
}

function humanizeTool(tool: string) {
  return tool.charAt(0).toUpperCase() + tool.slice(1).replace(/-/g, " ")
}

// The agent name as a byline on an answer. Most names humanize cleanly
// ("redline" -> "Redline"); the few that don't get a friendlier label here.
const AGENT_LABELS: Record<string, string> = { qa: "Q&A" }
const agentLabel = (name: string) => AGENT_LABELS[name] ?? humanizeTool(name)

// Verbs that turn a raw tool name + its target into a readable action line
// ("Read Share Purchase Agreement.docx"), so the timeline narrates each step the
// way a familiar legal-agent UI does rather than dumping the tool's own title.
const TOOL_VERBS: Record<string, string> = {
  read: "Read",
  write: "Wrote",
  edit: "Edited",
  list: "Listed",
  glob: "Searched files",
  grep: "Searched",
  bash: "Ran",
  redline: "Redlined",
}

const basename = (s: string) => s.split("/").filter(Boolean).pop() ?? s

// The matter's internal bookkeeping files are plumbing, not legal work — name
// them in plain language instead of leaking raw filenames into the timeline.
const INTERNAL_FILES: Record<string, string> = {
  "matter.json": "Reviewed the matter details",
  "grid.json": "Reviewed the document grid",
}

// The reviewers a workflow spawns, named by legal role rather than subagent id.
const SUBAGENT_ROLES: Record<string, string> = {
  "legal-reviewer": "Reviewer",
  "assumption-challenger": "Challenger",
  summarizer: "Summary",
}

// One readable label for a tool step. search-document is the matter's core
// retrieval call, so it reads as a search for its query (not the raw passage
// count); file tools read as a verb plus the file's basename; the matter folder
// and its internal files read in plain language; anything else falls back to a
// cleaned-up title.
function stepLabel(p: Extract<Part, { type: "tool" }>, matter: string): string {
  const input = "input" in p.state ? (p.state.input as Record<string, unknown> | undefined) : undefined
  const title = p.state.status === "completed" || p.state.status === "running" ? p.state.title : undefined

  if (p.tool === "search-document") {
    const query = (input?.query as string | undefined) ?? title?.match(/"([^"]+)"/)?.[1]
    if (!query) return "Searching documents"
    const doc = input?.document as string | undefined
    return doc ? `Searched ${basename(doc)} for "${query}"` : `Searched documents for "${query}"`
  }

  // A workflow coordinates its reviewers through the task tool; name each by its
  // legal role rather than the raw subagent id so the timeline reads like a team.
  if (p.tool === "task") {
    const role = input?.subagent_type as string | undefined
    return role ? `Consulted the ${SUBAGENT_ROLES[role] ?? humanizeTool(role)}` : "Coordinated the review"
  }

  const verb = TOOL_VERBS[p.tool]
  const target = title ?? (typeof input?.filePath === "string" ? input.filePath : undefined)
  if (!target) return humanizeTool(p.tool)
  const name = basename(target)
  if (name === matter) return "Browsed the matter files"
  if (INTERNAL_FILES[name]) return INTERNAL_FILES[name]
  return verb ? `${verb} ${name}` : name
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

// Aggregate every part received this turn into the live view. Reasoning and
// tool parts are only ever emitted by the assistant, so the timeline and
// citations read straight off them — independent of the role map. The role map
// gates only the answer text, so the user's own prompt part is never echoed
// back into the assistant bubble. Gating steps on the role would strand them as
// "Thinking..." whenever a part.updated outraces its message.updated.
function readTurn(parts: Map<string, Part>, roles: Map<string, string>, matter: string, sessionID: string) {
  const all = [...parts.values()]
  // The answer and the top-level timeline belong to the workflow's own session;
  // subagent-session parts are pooled only to nest under their task step.
  const own = all.filter((p) => p.sessionID === sessionID)
  const text = own
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .filter((p) => roles.get(p.messageID) === "assistant")
    .map((p) => p.text)
    .join("")
  const work = own.filter((p) => p.type === "reasoning" || p.type === "tool")
  const citations = work
    .filter((p): p is Extract<Part, { type: "tool" }> => p.type === "tool")
    .filter((p) => p.tool === "search-document" && p.state.status === "completed")
    .flatMap((p) => ((p.state as { metadata?: { citations?: Citation[] } }).metadata?.citations ?? []))
  return { text, citations, redlines: redlinesOf(work), steps: partsToSteps(work, matter, all) }
}

// Group stored messages into turns. A tool-using turn spans several consecutive
// assistant messages (one per model step); merging their parts reconstructs the
// whole reasoning timeline instead of showing only the final answer bubble.
function toTurns(
  msgs: { info: { id: string; role: "user" | "assistant"; agent?: string }; parts: Part[] }[],
  matter: string,
): Turn[] {
  const groups: { role: "user" | "assistant"; id: string; parts: Part[]; agent?: string }[] = []
  // An assistant turn answers the most recent user turn, so it inherits that
  // user message's agent — the server only stamps the agent on user messages.
  let lastAgent: string | undefined
  for (const m of msgs) {
    if (m.info.role === "user" && m.info.agent) lastAgent = m.info.agent
    const last = groups[groups.length - 1]
    if (last && last.role === "assistant" && m.info.role === "assistant") last.parts.push(...m.parts)
    else groups.push({ role: m.info.role, id: m.info.id, parts: [...m.parts], agent: lastAgent })
  }
  return groups
    .map((g) => ({
      role: g.role,
      id: g.id,
      agent: g.agent,
      ...contentOf(g.parts),
      steps: g.role === "assistant" ? partsToSteps(g.parts, matter) : [],
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
  onSessionCreated,
  onSessionStarted,
  onViewDocument,
}: {
  directory: string
  sessionID?: string
  agent: string
  available: Set<string>
  onAgentChange: (name: string) => void
  // Open the redline viewer on a document, optionally scrolled to a specific
  // proposal — fired by the in-chat redline preview's "View in document" link.
  onViewDocument: (name: string, redlineId?: number) => void
  // Called once the first message lazily mints a session, so the parent can put
  // its id in the URL — a reload then restores the conversation instead of a
  // blank chat. Fired at finalize, never mid-stream, to avoid reloading the
  // in-flight turn out from under the live view.
  onSessionCreated?: (id: string) => void
  // Fired the instant a session is minted, so the conversation rail can list the
  // new chat immediately rather than waiting for the turn to settle. Unlike
  // onSessionCreated this must not change the URL — that would remount the panel
  // and drop the in-flight stream — it only signals a re-list.
  onSessionStarted?: () => void
}) {
  const client = useMemo<Client>(() => matterClient(directory), [directory])
  const matterName = basename(directory)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ index: number; draft: string } | null>(null)
  const [, bump] = useState(0)

  const sessionRef = useRef<string>("")
  const freshRef = useRef(false)
  const partsRef = useRef<Map<string, Part>>(new Map())
  const rolesRef = useRef<Map<string, string>>(new Map())
  // Child subagent sessions a task step spawned this turn. Their parts stream on
  // their own sessionID, so we admit those into partsRef to nest under the task
  // step (see partsToSteps). Reset alongside partsRef on each new turn.
  const childRef = useRef<Set<string>>(new Set())
  const logRef = useRef<HTMLDivElement>(null)
  // Mirrors `busy` for the long-lived event subscription, whose resync closure is
  // created once and would otherwise capture a stale value.
  const busyRef = useRef(false)
  busyRef.current = busy

  useEffect(() => {
    const controller = new AbortController()
    if (sessionID) {
      sessionRef.current = sessionID
      getMessages(client, sessionID).then((msgs) => {
        setTurns(toTurns(msgs, matterName))
        // Reopening a past conversation pre-selects the agent it last ran on,
        // read off the most recent user turn (the server stamps each one with
        // its agent), so the picker reflects where the thread left off.
        const last = [...msgs].reverse().find((m) => m.info.role === "user")?.info
        if (last && "agent" in last && last.agent) onAgentChange(last.agent)
      })
    }
    // No session until the first send (see onSend) — mounting the panel must not
    // mint an empty throwaway session that would clutter the conversation list.
    subscribeEvents(client, onEvent, controller.signal, resync).catch(() => {})
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
      const own = part.sessionID === sessionRef.current
      if (!own && !childRef.current.has(part.sessionID)) return
      partsRef.current.set(part.id, part)
      // A task tool part names the child session it spawned; track that session
      // so its reasoning/tool parts get admitted and nest under this step.
      if (own && part.type === "tool" && part.tool === "task") {
        const child = (part.state as { metadata?: { sessionId?: string } }).metadata?.sessionId
        if (child) childRef.current.add(child)
      }
      bump((n) => n + 1)
      return
    }
    if (event.type === "session.idle" && event.properties.sessionID === sessionRef.current) {
      finalize()
    }
  }

  // The event stream dropped and reconnected, so any parts (and the session.idle)
  // emitted during the gap were missed. If a turn is in flight, pull the active
  // session and merge its parts back into the live view so it catches up instead
  // of stalling on a partial turn; if that turn already settled while we were
  // disconnected, its session.idle was missed too, so finalize from the server's
  // completion marker. A settled view needs nothing — its reload already ran.
  async function resync() {
    if (!busyRef.current || !sessionRef.current) return
    const msgs = await getMessages(client, sessionRef.current)
    for (const m of msgs) {
      rolesRef.current.set(m.info.id, m.info.role)
      for (const p of m.parts) partsRef.current.set(p.id, p)
    }
    bump((n) => n + 1)
    const last = [...msgs].reverse().find((m) => m.info.role === "assistant")?.info
    if (last?.role === "assistant" && last.time.completed) finalize()
  }

  // Reload the settled history from the server rather than appending the
  // in-flight turn from refs. The reload gives every turn its authoritative
  // message id, which edit/retry need to revert the session to a given turn.
  async function finalize() {
    if (sessionRef.current) setTurns(toTurns(await getMessages(client, sessionRef.current), matterName))
    partsRef.current.clear()
    rolesRef.current.clear()
    childRef.current.clear()
    setBusy(false)
    if (freshRef.current) {
      freshRef.current = false
      onSessionCreated?.(sessionRef.current)
    }
  }

  async function onSend() {
    const text = input.trim()
    if (!text || busy) return
    setTurns((prev) => [...prev, { role: "user", text, citations: [], redlines: [], steps: [] }])
    setInput("")
    setBusy(true)
    partsRef.current.clear()
    rolesRef.current.clear()
    childRef.current.clear()
    // Create the session lazily, titled from this first message so it reads as a
    // distinct conversation in the rail rather than an interchangeable "Q&A".
    if (!sessionRef.current) {
      sessionRef.current = (await createSession(client, titleFrom(text))).id
      freshRef.current = true
      onSessionStarted?.()
    }
    await sendPrompt(client, sessionRef.current, agent, text)
  }

  // A workflow is a canned, orchestrated run that streams into the chat like any
  // answer, rather than a separate artifact surface. A matter-scoped routine spans
  // every document, so it opens its own fresh conversation; a document-scoped one
  // continues the current thread. Either way its subagent steps show on the
  // timeline and the combined report streams as the assistant turn.
  async function runWorkflow(name: string) {
    if (busy) return
    const wf = WORKFLOWS.find((w) => w.name === name)
    if (!wf) return
    setBusy(true)
    partsRef.current.clear()
    rolesRef.current.clear()
    childRef.current.clear()
    if (wf.scope === "matter") sessionRef.current = ""
    setTurns((prev) =>
      wf.scope === "matter"
        ? [{ role: "user", text: wf.prompt, citations: [], redlines: [], steps: [] }]
        : [...prev, { role: "user", text: wf.prompt, citations: [], redlines: [], steps: [] }],
    )
    if (!sessionRef.current) {
      sessionRef.current = (await createSession(client, wf.label)).id
      freshRef.current = true
      onSessionStarted?.()
    }
    await sendPrompt(client, sessionRef.current, wf.name, wf.prompt)
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
    childRef.current.clear()
    setTurns((prev) => [...prev.slice(0, index), { role: "user", text, citations: [], redlines: [], steps: [] }])
    await revertMessage(client, sessionRef.current, turn.id)
    await sendPrompt(client, sessionRef.current, agent, text)
  }

  const live = readTurn(partsRef.current, rolesRef.current, matterName, sessionRef.current)

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Ask the matter</h2>
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
            <div key={i} className="msg-user-wrap">
              <div className="msg user">
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
                  t.text
                )}
              </div>
              {editing?.index !== i && t.id && !busy && (
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
            </div>
          ) : (
            <div key={i} className="msg assistant">
              {t.agent && <div className="msg-agent">{agentLabel(t.agent)}</div>}
              <StepsPanel steps={t.steps} busy={false} answered={Boolean(t.text)} />
              {t.text && <Markdown>{t.text}</Markdown>}
              <CitationView citations={t.citations} />
              <RedlineView redlines={t.redlines} onView={onViewDocument} />
            </div>
          ),
        )}
        {busy && (
          <div className="msg assistant">
            <div className="msg-agent">{agentLabel(agent)}</div>
            <StepsPanel steps={live.steps} busy answered={Boolean(live.text)} />
            {live.text ? (
              <Markdown>{live.text}</Markdown>
            ) : (
              live.steps.length === 0 && <span className="muted">Thinking...</span>
            )}
            <CitationView citations={live.citations} />
            <RedlineView redlines={live.redlines} onView={onViewDocument} />
          </div>
        )}
      </div>
      <div className="composer-tools">
        <ModelSelector available={available} value={agent} onChange={onAgentChange} />
        <WorkflowLauncher available={available} onLaunch={runWorkflow} />
      </div>
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
// each on a dotted timeline. It is the focus only while the model is still
// working with nothing to read yet; the instant the answer streams (or the turn
// settles) it collapses to a one-line affordance so the prose owns the view —
// the handoff Harvey and Legora make from "working" to "answer". A manual toggle
// still wins until the next phase change.
function StepsPanel({ steps, busy, answered }: { steps: Step[]; busy: boolean; answered: boolean }) {
  const thinking = busy && !answered
  const [open, setOpen] = useState(thinking)
  useEffect(() => setOpen(thinking), [thinking])
  if (steps.length === 0) return null
  return (
    <details className="steps" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{thinking ? "Working..." : `${steps.length} step${steps.length === 1 ? "" : "s"}`}</summary>
      <StepList steps={steps} busy={busy} />
    </details>
  )
}

// One level of the timeline. Each tool step that spawned a subagent nests that
// subagent's own steps as a deeper list, so a consulted reviewer's thinking and
// tool calls stream live beneath "Consulted the Reviewer" rather than the step
// sitting opaque while the child works. Recurses to any depth.
function StepList({ steps, busy }: { steps: Step[]; busy: boolean }) {
  return (
    <ol className="step-list">
      {steps.map((s, i) => (
        <StepRow key={i} step={s} busy={busy} last={i === steps.length - 1} />
      ))}
    </ol>
  )
}

function StepRow({ step, busy, last }: { step: Step; busy: boolean; last: boolean }) {
  // The last step in a still-running list is the one in flight: a tool not yet
  // done, or a thinking block still streaming. That one stays open and live.
  const active = busy && last
  if (step.kind === "tool")
    return (
      <li className="step">
        <span className={`dot ${step.status}`} />
        {step.detail ? (
          <details className="step-detail">
            <summary className="step-label">{step.label}</summary>
            <pre className="step-output">{step.detail}</pre>
          </details>
        ) : (
          <span className="step-label">{step.label}</span>
        )}
        {step.children && step.children.length > 0 && (
          <StepList steps={step.children} busy={busy && step.status === "running"} />
        )}
      </li>
    )
  // The block still streaming reads as "Analyzing..." and stays open; settled
  // blocks collapse to "Thought process" so the timeline is calm.
  const live = active && !step.done
  return (
    <li className="step">
      <span className={`dot reasoning${live ? " running" : ""}`} />
      <details className="thinking" open={live}>
        <summary>{live ? "Analyzing..." : "Thought process"}</summary>
        <Markdown>{step.text}</Markdown>
      </details>
    </li>
  )
}

// In-chat preview of the redlines a turn proposed: each shows the prior wording
// struck red above the new wording in green — the same red/green the document
// viewer paints — so the lawyer sees the change without leaving the chat, with a
// link straight into the full tracked-changes review for that proposal.
function RedlineView({
  redlines,
  onView,
}: {
  redlines: RedlineProposal[]
  onView: (name: string, redlineId?: number) => void
}) {
  if (redlines.length === 0) return null
  return (
    <div className="redlines">
      {redlines.map((r, i) => (
        <div className="redline-card" key={i}>
          <div className="redline-doc">{basename(r.document)}</div>
          {r.oldText && <div className="redline-old">{r.oldText}</div>}
          <div className="redline-new">{r.newText}</div>
          <button className="linklike redline-view" onClick={() => onView(basename(r.document), r.id)}>
            View in document
          </button>
        </div>
      ))}
    </div>
  )
}
