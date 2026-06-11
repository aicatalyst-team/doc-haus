import { useEffect, useMemo, useRef, useState } from "react"
import type { Event, Part } from "@opencode-ai/sdk"
import {
  createSession,
  getConfig,
  getMessages,
  listPermissions,
  matterClient,
  replyPermission,
  revertMessage,
  routeAgent,
  sendPrompt,
  subscribeEvents,
  type Citation,
  type Client,
  type PermissionEvent,
  type PermissionReply,
  type PermissionRequest,
} from "../api/opencode"
import { CHAT_ASSISTANTS, isAuto, TEMPLATE_BUILDER, WORKFLOWS, type AssistantMeta } from "../agents"
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
  // Documents the turn created (draft-document tool), as matter-relative names —
  // each renders as a card linking into the document viewer.
  drafts: string[]
  steps: Step[]
  id?: string
  agent?: string
  // A failed assistant turn carries the provider's error message instead of an
  // answer. Without surfacing it the turn has no text/steps and toTurns would
  // drop it, so the chat would silently show nothing — the model appears to
  // "think" then vanish. Render this so failures (bad project, quota, auth) are
  // visible and actionable.
  error?: string
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
  return { text, citations, redlines: redlinesOf(parts), drafts: draftsOf(parts) }
}

// The draft-document tool stamps the created document's path on its metadata.
// Surface each as a document name the bubble can card and link into the viewer.
function draftsOf(parts: Part[]): string[] {
  return parts
    .filter((p): p is Extract<Part, { type: "tool" }> => p.type === "tool")
    .filter((p) => p.tool === "draft-document" && p.state.status === "completed")
    .flatMap((p) => {
      const document = (p.state as { metadata?: Record<string, unknown> }).metadata?.document
      return typeof document === "string" ? [basename(document)] : []
    })
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

// The agent name as a byline on an answer. Prefer the registry's own label (so
// "qa" reads "Q&A" and "redliner" reads "Redline"); anything off-registry
// humanizes cleanly ("redline" -> "Redline").
const AGENT_LABELS: Record<string, string> = Object.fromEntries(
  [...CHAT_ASSISTANTS, TEMPLATE_BUILDER].map((a) => [a.name, a.label]),
)
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

// A real answer always contains at least one letter or digit. When a turn
// settles with text that is only braces or punctuation (e.g. a lone "}" leaked
// from a truncated or malformed generation), it is not an answer — render a
// retry affordance instead of the garbage. Citations still show below.
const isEmptyAnswer = (text?: string) => !text || !/[\p{L}\p{N}]/u.test(text)

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
  return { text, citations, redlines: redlinesOf(work), drafts: draftsOf(work), steps: partsToSteps(work, matter, all) }
}

// Group stored messages into turns. A tool-using turn spans several consecutive
// assistant messages (one per model step); merging their parts reconstructs the
// whole reasoning timeline instead of showing only the final answer bubble.
function toTurns(
  msgs: { info: { id: string; role: "user" | "assistant"; agent?: string; error?: MessageError }; parts: Part[] }[],
  matter: string,
): Turn[] {
  const groups: { role: "user" | "assistant"; id: string; parts: Part[]; agent?: string; error?: string }[] = []
  // An assistant turn answers the most recent user turn, so it inherits that
  // user message's agent — the server only stamps the agent on user messages.
  let lastAgent: string | undefined
  for (const m of msgs) {
    if (m.info.role === "user" && m.info.agent) lastAgent = m.info.agent
    const last = groups[groups.length - 1]
    if (last && last.role === "assistant" && m.info.role === "assistant") {
      last.parts.push(...m.parts)
      last.error = last.error ?? errorOf(m.info.error)
    } else
      groups.push({ role: m.info.role, id: m.info.id, parts: [...m.parts], agent: lastAgent, error: errorOf(m.info.error) })
  }
  return groups
    .map((g) => ({
      role: g.role,
      id: g.id,
      agent: g.agent,
      error: g.error,
      ...contentOf(g.parts),
      steps: g.role === "assistant" ? partsToSteps(g.parts, matter) : [],
    }))
    .filter((t) => t.text || t.citations.length || t.steps.length || t.error)
}

// The provider error the engine stamps on a failed assistant message. Shape is
// { name, data: { message, ... } } (see the APIError surfaced by the prompt
// route); fall back to the error name if no message string is present.
type MessageError = { name?: string; data?: { message?: string } }
function errorOf(error: MessageError | undefined) {
  if (!error) return undefined
  return error.data?.message ?? error.name ?? "The model returned an error."
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
  created,
  initialPrompt,
  agent,
  available,
  pinned,
  title = "Ask the matter",
  emptyHint = "Ask a question about this matter's documents. Every answer cites the source section.",
  starters = STARTERS,
  composerPlaceholder = "e.g. What termination rights does each party have?",
  onAgentChange,
  onSessionCreated,
  onSessionStarted,
  onViewDocument,
  onDocumentsChanged,
}: {
  directory: string
  sessionID?: string
  // This mount is the just-minted session, not a chat reopened from the rail.
  // The first send mints a session, which flips the URL and remounts the panel
  // under the new id (see onSessionCreated). The user was typing here a beat ago,
  // so seat the cursor like a fresh chat rather than treating it as a reopen.
  created?: boolean
  // A prompt to seat the composer with on a fresh chat (no session yet) — e.g.
  // "Save as template" deep-links into chat with the drafter pinned and this
  // prefilled. Prefilled, not auto-sent: the lawyer reviews and sends it.
  initialPrompt?: string
  agent: string
  available: Set<string>
  // A single fixed assistant for this surface (e.g. the Templates page's
  // template-builder). Replaces the assistant picker and workflow launcher with a
  // static chip — there is nothing to choose when one agent owns the room.
  pinned?: AssistantMeta
  // Surface copy — defaults read for a matter chat; other surfaces (the template
  // library) pass their own heading, empty-state hint, starters, and placeholder.
  title?: string
  emptyHint?: string
  starters?: string[]
  composerPlaceholder?: string
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
  // Fired when a tool changed the matter's document set mid-turn (a draft was
  // created), so the documents rail refreshes without waiting for a reload.
  onDocumentsChanged?: () => void
}) {
  const client = useMemo<Client>(() => matterClient(directory), [directory])
  const matterName = basename(directory)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  // Reopening a past conversation refetches its messages, leaving turns empty for
  // a beat. Without this the empty-starter state ("Ask a question...") flashes in
  // that gap; gate it on !loading and show a skeleton instead. A fresh chat (no
  // sessionID) has nothing to load, so it stays false and the starters show now.
  const [loading, setLoading] = useState(Boolean(sessionID))
  // Edit-tool calls the engine parked awaiting the user's approval (see the
  // ctx.ask gates in dochaus/tool/*). Each renders an approval card above the
  // composer; the turn stays "working" until every request is answered.
  const [permissions, setPermissions] = useState<PermissionRequest[]>([])
  const [editing, setEditing] = useState<{ index: number; draft: string } | null>(null)
  // While Auto is selected, the real agent the last message routed to — drives the
  // "Auto · Redline" chip and the in-flight bubble's byline. Cleared when the user
  // leaves Auto so a stale routing never lingers on the chip.
  const [resolvedAgent, setResolvedAgent] = useState<string>()
  const [, bump] = useState(0)

  const sessionRef = useRef<string>("")
  const freshRef = useRef(false)
  const partsRef = useRef<Map<string, Part>>(new Map())
  const rolesRef = useRef<Map<string, string>>(new Map())
  // Child subagent sessions a task step spawned this turn. Their parts stream on
  // their own sessionID, so we admit those into partsRef to nest under the task
  // step (see partsToSteps). Reset alongside partsRef on each new turn.
  const childRef = useRef<Set<string>>(new Set())
  // Message ids already folded into the settled `turns`. The live view aggregates
  // every part in partsRef indiscriminately, so it assumes partsRef holds only the
  // in-flight turn. Two things break that: trailing SSE part.updated events from a
  // just-finalized turn landing after the clear, and resync pulling full session
  // history. Both re-admit prior-turn parts, making the live bubble flash the
  // previous answer. Reject any part whose message is already settled to keep
  // partsRef scoped to the current turn.
  const seenRef = useRef<Set<string>>(new Set())
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Mirrors `busy` for the long-lived event subscription, whose resync closure is
  // created once and would otherwise capture a stale value.
  const busyRef = useRef(false)
  busyRef.current = busy

  useEffect(() => {
    const controller = new AbortController()
    if (sessionID) {
      sessionRef.current = sessionID
      setLoading(true)
      getMessages(client, sessionID).then((msgs) => {
        setTurns(toTurns(msgs, matterName))
        for (const m of msgs) seenRef.current.add(m.info.id)
        // Reopening a past conversation pre-selects the agent it last ran on,
        // read off the most recent user turn (the server stamps each one with
        // its agent) — but only when the user has explicitly picked an agent.
        // On Auto the stamp is just what routing chose last (and this effect
        // also fires when the first send mints the session and remounts the
        // panel), so restoring it would silently flip the picker off Auto.
        const last = [...msgs].reverse().find((m) => m.info.role === "user")?.info
        if (last && "agent" in last && last.agent) {
          if (isAuto(agent)) setResolvedAgent(last.agent)
          if (!isAuto(agent)) onAgentChange(last.agent)
        }
        setLoading(false)
      })
    }
    // No session until the first send (see onSend) — mounting the panel must not
    // mint an empty throwaway session that would clutter the conversation list.
    subscribeEvents(client, onEvent, controller.signal, resync).catch(() => {})
    // A backgrounded tab can have its SSE socket killed by the browser without
    // the stream ever ending, so the reconnect loop never fires and the turn
    // sticks on "Thinking...". Resync when the tab comes back, plus a slow poll
    // as a net for silent stalls; resync is a no-op unless a turn is in flight.
    const onVisible = () => {
      if (document.visibilityState === "visible") resync()
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onVisible)
    const poll = setInterval(resync, 15000)
    return () => {
      controller.abort()
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", onVisible)
      clearInterval(poll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, sessionID])

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  })

  // A fresh chat (no session yet) seats the cursor in the composer on mount so
  // the lawyer can type immediately, as does the remount that follows the first
  // send minting a session (`created`) — same composer, so keep the cursor in it.
  // A conversation reopened from the rail skips this; it focuses once a turn
  // settles (see below).
  useEffect(() => {
    // A fresh chat deep-linked with a prompt (e.g. "Save as template") seats it in
    // the composer for the lawyer to review and send — prefill, never auto-send.
    if (initialPrompt && !sessionID) setInput(initialPrompt)
    if (!sessionID || created) inputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refocus the composer the moment a turn settles (busy → false). Done in an
  // effect, not inline in finalize(), so it runs after React commits the
  // settled turns: calling focus() inside finalize fires before that re-render,
  // landing on a node React then reconciles away — which is why the refocus only
  // worked intermittently.
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !busy) inputRef.current?.focus()
    wasBusy.current = busy
  }, [busy])

  // Admit a streamed part into the live view. The moment a draft-document or
  // create-template call completes (not on its later re-deliveries), the
  // surface's document set changed — tell the parent so its list (the documents
  // rail, the template library) picks up the new file mid-turn.
  function admitPart(part: Part) {
    const prev = partsRef.current.get(part.id)
    partsRef.current.set(part.id, part)
    if (
      part.type === "tool" &&
      (part.tool === "draft-document" || part.tool === "create-template") &&
      part.state.status === "completed" &&
      !(prev?.type === "tool" && prev.state.status === "completed")
    )
      onDocumentsChanged?.()
  }

  function onEvent(event: Event) {
    // The v1 SDK's Event union predates the permission events, so narrow the raw
    // stream envelope ({ type, properties }) through PermissionEvent ourselves.
    const pe = event as unknown as PermissionEvent
    if (pe.type === "permission.asked") {
      const req = pe.properties
      if (req.sessionID !== sessionRef.current && !childRef.current.has(req.sessionID)) return
      setPermissions((prev) => [...prev.filter((p) => p.id !== req.id), req])
      return
    }
    if (pe.type === "permission.replied") {
      setPermissions((prev) => prev.filter((p) => p.id !== pe.properties.requestID))
      return
    }
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
      if (seenRef.current.has(part.messageID)) return
      admitPart(part)
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
      if (seenRef.current.has(m.info.id)) continue
      rolesRef.current.set(m.info.id, m.info.role)
      for (const p of m.parts) admitPart(p)
    }
    // A permission.asked emitted during the gap was missed the same way as the
    // parts — without it the turn sits parked on an approval nobody can see.
    const pending = await listPermissions(directory)
    setPermissions(pending.filter((p) => p.sessionID === sessionRef.current || childRef.current.has(p.sessionID)))
    bump((n) => n + 1)
    // Finalize only when THIS turn produced a NEW settled answer: the last message
    // overall is a completed assistant whose id we have not already settled.
    // seenRef holds every settled message id (see load/finalize). Two cases this
    // rules out, both of which otherwise dropped the optimistic in-flight turn and
    // hid the bubble until a later session.idle re-rendered it all at once:
    //  - Auto routing/choosing: the prompt is not sent yet, so the last persisted
    //    message is the PRIOR turn's completed assistant — already in seenRef.
    //  - just after dispatch, before the server has persisted this turn's messages,
    //    the last message is still that prior completed assistant.
    // While streaming, the last message is this turn's assistant but not yet
    // completed; once it completes it is new (not in seenRef) and we finalize.
    const last = msgs[msgs.length - 1]?.info
    if (last?.role === "assistant" && last.time.completed && !seenRef.current.has(last.id)) finalize()
  }

  // Reload the settled history from the server rather than appending the
  // in-flight turn from refs. The reload gives every turn its authoritative
  // message id, which edit/retry need to revert the session to a given turn.
  async function finalize() {
    if (sessionRef.current) {
      // If this reload fails the turn is not lost: leave busy set and the refs
      // intact so the 15s resync poll retries finalize, instead of clearing the
      // live view and hanging on a half-settled turn.
      const msgs = await getMessages(client, sessionRef.current).catch(() => undefined)
      if (!msgs) return
      setTurns(toTurns(msgs, matterName))
      for (const m of msgs) seenRef.current.add(m.info.id)
    }
    partsRef.current.clear()
    rolesRef.current.clear()
    childRef.current.clear()
    setPermissions([])
    setBusy(false)
    if (freshRef.current) {
      freshRef.current = false
      onSessionCreated?.(sessionRef.current)
    }
  }

  // A send failed before the turn ever reached a settled state — routing, lazy
  // session creation, the revert, or the prompt request itself rejected. This is
  // common when the engine is briefly unreachable right after navigating back
  // into a matter. No session.idle will come to clear busy, so without this the
  // bubble hangs on "Thinking..." forever (and if session creation was what
  // failed, sessionRef is empty so the resync poll cannot recover it either).
  // Surface the failure as an error turn and settle so the composer reopens.
  function failTurn(message: string) {
    partsRef.current.clear()
    rolesRef.current.clear()
    childRef.current.clear()
    setTurns((prev) => [
      ...prev,
      { role: "assistant", text: "", citations: [], redlines: [], drafts: [], steps: [], error: message },
    ])
    setBusy(false)
  }

  // Resolve which real agent answers this message. With Auto selected, a cheap
  // model routes the message to one of the real assistants; otherwise the picked
  // agent is used as-is. `prior` is the user turns before this one, newest last —
  // the last two seed the router with conversational context. The result stamps
  // the user message, so it must be a real agent id: routing never returns "auto",
  // and any failure or timeout falls back to "qa". The resolved agent drives
  // the "Auto · <label>" chip and the in-flight bubble's byline.
  async function resolveAgent(text: string, prior: Turn[]) {
    if (!isAuto(agent)) return agent
    const history = prior
      .filter((t) => t.role === "user")
      .slice(-2)
      .map((t) => t.text)
    // Like routeAgent, this read must not block the send: a stalled fetch would
    // never reject, so cap it and fall back to the default small model.
    const config = await Promise.race([
      getConfig().catch(() => undefined),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3000)),
    ])
    // Route through the engine using its configured small model, whatever provider
    // it lives on. OpenCode resolves the provider and credentials, so Auto works
    // on Vertex, Bedrock, Azure, OpenAI, or Ollama alike (see routeAgent).
    const small = config?.small_model ?? config?.model ?? "google-vertex/gemini-3.5-flash"
    const resolved = await routeAgent({
      client,
      smallModel: small,
      // On a miss (a weak small model returns an off-list name) routeAgent retries
      // the route on the primary model before defaulting to Q&A. Omitted when it
      // equals small, so a single-model setup never pays for a duplicate call.
      primaryModel: config?.model,
      candidates: CHAT_ASSISTANTS.map((a) => ({ name: a.name, description: a.description })),
      history,
      text,
    }).catch((err) => {
      console.warn("Auto routing failed, falling back to Q&A", err)
      return "qa"
    })
    setResolvedAgent(resolved)
    return resolved
  }

  async function onSend() {
    const text = input.trim()
    if (!text || busy) return
    const prior = turns
    setTurns((prev) => [...prev, { role: "user", text, citations: [], redlines: [], drafts: [], steps: [] }])
    setInput("")
    setBusy(true)
    partsRef.current.clear()
    rolesRef.current.clear()
    childRef.current.clear()
    try {
      const resolved = await resolveAgent(text, prior)
      // Create the session lazily, titled from this first message so it reads as a
      // distinct conversation in the rail rather than an interchangeable "Q&A".
      if (!sessionRef.current) {
        sessionRef.current = (await createSession(client, titleFrom(text))).id
        freshRef.current = true
        onSessionStarted?.()
      }
      await sendPrompt(client, sessionRef.current, resolved, text)
    } catch (e) {
      failTurn(e instanceof Error ? e.message : "Could not reach the engine. Try again.")
    }
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
        ? [{ role: "user", text: wf.prompt, citations: [], redlines: [], drafts: [], steps: [] }]
        : [...prev, { role: "user", text: wf.prompt, citations: [], redlines: [], drafts: [], steps: [] }],
    )
    try {
      if (!sessionRef.current) {
        sessionRef.current = (await createSession(client, wf.label)).id
        freshRef.current = true
        onSessionStarted?.()
      }
      await sendPrompt(client, sessionRef.current, wf.name, wf.prompt)
    } catch (e) {
      failTurn(e instanceof Error ? e.message : "Could not start the workflow. Try again.")
    }
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
    setTurns((prev) => [...prev.slice(0, index), { role: "user", text, citations: [], redlines: [], drafts: [], steps: [] }])
    try {
      const resolved = await resolveAgent(text, turns.slice(0, index))
      await revertMessage(client, sessionRef.current, turn.id)
      await sendPrompt(client, sessionRef.current, resolved, text)
    } catch (e) {
      failTurn(e instanceof Error ? e.message : "Could not reach the engine. Try again.")
    }
  }

  // Optimistic removal — the engine's permission.replied event confirms it, and
  // a reject cascades rejection to the session's other pending requests, whose
  // replied events clear them here too.
  async function onPermissionReply(id: string, reply: PermissionReply) {
    setPermissions((prev) => prev.filter((p) => p.id !== id))
    await replyPermission(directory, id, reply)
  }

  const live = readTurn(partsRef.current, rolesRef.current, matterName, sessionRef.current)

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
      </div>
      <div className="chat-log" ref={logRef}>
        {loading && turns.length === 0 && <ChatSkeleton />}
        {!loading && turns.length === 0 && !busy && (
          <div className="chat-empty">
            <p className="muted">{emptyHint}</p>
            <div className="starters">
              {starters.map((s) => (
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
              <StepsPanel steps={t.steps} busy={false} answered={!isEmptyAnswer(t.text)} />
              {t.text && !isEmptyAnswer(t.text) && <Markdown>{t.text}</Markdown>}
              {t.error && <div className="msg-error">{t.error}</div>}
              {!t.error && isEmptyAnswer(t.text) && t.redlines.length === 0 && t.drafts.length === 0 && (
                <div className="msg-error">
                  No answer was produced for this question.{" "}
                  <button
                    style={{ background: "none", border: 0, padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit" }}
                    onClick={() => {
                      const prev = turns[i - 1]
                      if (prev) resendFrom(prev, i - 1, prev.text)
                    }}
                  >
                    Retry
                  </button>
                </div>
              )}
              <CitationView citations={t.citations} />
              <RedlineView redlines={t.redlines} onView={onViewDocument} />
              <DraftView drafts={t.drafts} onView={onViewDocument} />
            </div>
          ),
        )}
        {busy && (
          <div className="msg assistant">
            <div className="msg-agent">{agentLabel(isAuto(agent) && resolvedAgent ? resolvedAgent : agent)}</div>
            <StepsPanel steps={live.steps} busy answered={Boolean(live.text)} />
            {live.text ? (
              <Markdown>{live.text}</Markdown>
            ) : (
              live.steps.length === 0 && <span className="muted">Thinking...</span>
            )}
            <CitationView citations={live.citations} />
            {live.text && <RedlineView redlines={live.redlines} onView={onViewDocument} />}
            <DraftView drafts={live.drafts} onView={onViewDocument} />
          </div>
        )}
      </div>
      {permissions.map((p) => (
        <PermissionCard key={p.id} request={p} onReply={onPermissionReply} />
      ))}
      <div className="composer-tools">
        {pinned ? (
          <span className="assistant-trigger" style={{ cursor: "default" }} title={pinned.description}>
            <svg className="assistant-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
              <path d="M20 3v4M22 5h-4M4 17v2M5 18H3" />
            </svg>
            <span className="assistant-trigger-label">{pinned.label}</span>
          </span>
        ) : (
          <>
            <ModelSelector
              available={available}
              value={agent}
              resolvedLabel={isAuto(agent) && resolvedAgent ? agentLabel(resolvedAgent) : undefined}
              onChange={(a) => {
                onAgentChange(a)
                // Leaving Auto drops the last routing so the chip does not keep showing
                // a resolved label under a manually-picked assistant.
                if (!isAuto(a)) setResolvedAgent(undefined)
                inputRef.current?.focus()
              }}
            />
            <WorkflowLauncher available={available} onLaunch={runWorkflow} />
          </>
        )}
      </div>
      <div className="composer">
        <textarea
          ref={inputRef}
          placeholder={composerPlaceholder}
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
      <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
        Not legal advice. AI can make mistakes.
        <br />
        Verify answers against the cited source before relying on them.
      </p>
    </div>
  )
}

// Placeholder shown while a reopened conversation's messages load, so the panel
// reads as "this thread is coming" rather than flashing the fresh-chat starters.
// Mirrors the message rhythm — a short user bubble answered by a taller assistant
// block — with shimmer bars standing in for the text.
function ChatSkeleton() {
  return (
    <div className="chat-skeleton" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="sk-turn">
          <div className="sk-bubble sk-user">
            <div className="sk-line" style={{ width: "60%" }} />
          </div>
          <div className="sk-bubble sk-assistant">
            <div className="sk-line" style={{ width: "92%" }} />
            <div className="sk-line" style={{ width: "98%" }} />
            <div className="sk-line" style={{ width: "74%" }} />
          </div>
        </div>
      ))}
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

// What each gated tool is asking to do, phrased for the approval card's title.
const PERMISSION_VERBS: Record<string, string> = {
  "word-integration": "edit",
  "tracked-changes": "propose a tracked change in",
  redline: "propose a redline in",
  "draft-document": "create",
  "create-template": "create the template",
}

// One parked edit-tool call awaiting the user's decision. The metadata the tool
// attached (find/replace or clause/replacement) previews the change in the same
// red/green the redline cards use. "Always allow" approves this document for the
// rest of the server's life — the engine remembers it per matter directory.
function PermissionCard({
  request,
  onReply,
}: {
  request: PermissionRequest
  onReply: (id: string, reply: PermissionReply) => void
}) {
  const meta = request.metadata
  const document = typeof meta.document === "string" ? meta.document : request.patterns[0] && basename(request.patterns[0])
  const oldText = (meta.find ?? meta.clause) as string | undefined
  const newText = (meta.replace ?? meta.replacement) as string | undefined
  const verb = PERMISSION_VERBS[request.permission] ?? `use ${humanizeTool(request.permission)} on`
  return (
    <div className="permission-card">
      <div className="permission-title">
        The assistant wants to {verb} {document ?? "a document"}
      </div>
      {(oldText || newText) && (
        <div className="permission-preview">
          {oldText && <div className="redline-old">{oldText}</div>}
          {newText && <div className="redline-new">{newText}</div>}
        </div>
      )}
      <div className="permission-actions">
        <button className="primary" onClick={() => onReply(request.id, "once")}>
          Allow once
        </button>
        <button onClick={() => onReply(request.id, "always")}>Always allow for this document</button>
        <button className="permission-reject" onClick={() => onReply(request.id, "reject")}>
          Reject
        </button>
      </div>
    </div>
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

// In-chat card for each document a turn drafted: the new file's name with a link
// straight into the document viewer, so the lawyer opens the draft without
// hunting for it in the documents rail.
function DraftView({ drafts, onView }: { drafts: string[]; onView: (name: string) => void }) {
  if (drafts.length === 0) return null
  return (
    <div className="drafts">
      {drafts.map((name, i) => (
        <div className="draft-card" key={i}>
          <span className="draft-doc">{name}</span>
          <button className="linklike" onClick={() => onView(name)}>
            Open document
          </button>
        </div>
      ))}
    </div>
  )
}
