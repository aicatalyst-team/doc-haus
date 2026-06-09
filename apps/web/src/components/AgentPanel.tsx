import { useEffect, useMemo, useRef, useState } from "react"
import type { Event, Part } from "@opencode-ai/sdk"
import { createSession, matterClient, sendPrompt, subscribeEvents, type Client } from "../api/opencode"
import Markdown from "./Markdown"

type TaskPart = Extract<Part, { type: "tool" }>

// Present the review roles in lawyer terms, not the raw subagent ids/statuses
// the harness emits. The work is the same; the labels just stop leaking plumbing.
const ROLE_LABELS: Record<string, string> = {
  reviewer: "Reviewer",
  challenger: "Challenger",
  summarizer: "Summary",
}
const STATUS_LABELS: Record<string, string> = {
  pending: "Queued",
  running: "Working",
  completed: "Done",
  error: "Failed",
}

// One row per reviewer the review coordinates through the task tool.
function SubagentResult({ part }: { part: TaskPart }) {
  const input = part.state.status === "completed" || part.state.status === "running" ? part.state.input : {}
  const role = (input as { subagent_type?: string }).subagent_type ?? part.tool
  const name = ROLE_LABELS[role] ?? role
  const status = STATUS_LABELS[part.state.status] ?? part.state.status
  const output = part.state.status === "completed" ? part.state.output : ""
  return (
    <div className="agent-step">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="name">{name}</span>
        <span className="status">
          <span className="badge">{status}</span>
        </span>
      </div>
      {output && (
        <div className="msg assistant" style={{ marginTop: 8 }}>
          <Markdown>{output}</Markdown>
        </div>
      )}
    </div>
  )
}

export default function AgentPanel({ directory }: { directory: string }) {
  const client = useMemo<Client>(() => matterClient(directory), [directory])
  const [busy, setBusy] = useState(false)
  const [ran, setRan] = useState(false)
  const [, bump] = useState(0)

  const sessionRef = useRef<string>("")
  const partsRef = useRef<Map<string, Part>>(new Map())
  const assistantRef = useRef<string>("")

  useEffect(() => {
    const controller = new AbortController()
    createSession(client, "doc.haus Legal Review").then((s) => (sessionRef.current = s.id))
    subscribeEvents(client, onEvent, controller.signal).catch(() => {})
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  function onEvent(event: Event) {
    if (event.type === "message.updated") {
      const info = event.properties.info
      if (info.sessionID === sessionRef.current && info.role === "assistant") assistantRef.current = info.id
      return
    }
    if (event.type === "message.part.updated" && event.properties.part.sessionID === sessionRef.current) {
      partsRef.current.set(event.properties.part.id, event.properties.part)
      bump((n) => n + 1)
      return
    }
    if (event.type === "session.idle" && event.properties.sessionID === sessionRef.current) setBusy(false)
  }

  async function onRun() {
    if (busy || !sessionRef.current) return
    partsRef.current.clear()
    assistantRef.current = ""
    setBusy(true)
    setRan(true)
    await sendPrompt(
      client,
      sessionRef.current,
      "legal-review",
      "Run a complete legal review of the documents in this matter. Coordinate the reviewer, challenger, and summarizer subagents and return the combined report.",
    )
  }

  const allParts = [...partsRef.current.values()]
  const tasks = allParts.filter((p): p is TaskPart => p.type === "tool" && p.tool === "task")
  const report = allParts
    .filter((p) => p.messageID === assistantRef.current && p.type === "text")
    .map((p) => (p as Extract<Part, { type: "text" }>).text)
    .join("")

  return (
    <div className="card">
      <h2>Full review</h2>
      <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
        A reviewer, a challenger, and a summarizer read every document and return one combined report.
      </p>
      <button className="primary" onClick={onRun} disabled={busy}>
        {busy ? "Running review..." : "Run full review"}
      </button>

      {ran && (
        <div style={{ marginTop: 16 }}>
          {tasks.length === 0 && busy && <p className="muted">Starting review...</p>}
          {tasks.map((p) => (
            <SubagentResult key={p.id} part={p} />
          ))}
          {report && (
            <div className="agent-step">
              <div className="name">Combined report</div>
              <div className="msg assistant" style={{ marginTop: 8 }}>
                <Markdown>{report}</Markdown>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
