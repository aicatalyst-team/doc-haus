import { useEffect, useMemo, useRef, useState } from "react"
import type { Event, Part } from "@opencode-ai/sdk"
import { createSession, matterClient, sendPrompt, subscribeEvents, type Client } from "../api/opencode"
import { WORKFLOWS } from "../agents"
import Markdown from "./Markdown"

type TaskPart = Extract<Part, { type: "tool" }>

// Present the review roles in lawyer terms, not the raw subagent ids/statuses the
// harness emits. Keys are the subagent_type values the orchestrator spawns.
const ROLE_LABELS: Record<string, string> = {
  "legal-reviewer": "Reviewer",
  "assumption-challenger": "Challenger",
  summarizer: "Summary",
}
const STATUS_LABELS: Record<string, string> = {
  pending: "Queued",
  running: "Working",
  completed: "Done",
  error: "Failed",
}

// One row per reviewer the workflow coordinates through the task tool.
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

// Artifact panel for one workflow run. Created with key={workflow} so launching a
// workflow remounts it fresh, which auto-starts the run on mount.
export default function WorkflowArtifact({
  directory,
  workflow,
  onClose,
}: {
  directory: string
  workflow: string
  onClose: () => void
}) {
  const meta = WORKFLOWS.find((w) => w.name === workflow)
  const client = useMemo<Client>(() => matterClient(directory), [directory])
  const [busy, setBusy] = useState(true)
  const [, bump] = useState(0)

  const sessionRef = useRef<string>("")
  const partsRef = useRef<Map<string, Part>>(new Map())
  const assistantRef = useRef<string>("")

  useEffect(() => {
    if (!meta) return
    const controller = new AbortController()
    subscribeEvents(client, onEvent, controller.signal).catch(() => {})
    createSession(client, `doc.haus ${meta.label}`).then((s) => {
      sessionRef.current = s.id
      return sendPrompt(client, s.id, meta.name, meta.prompt)
    })
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

  if (!meta) return null

  const allParts = [...partsRef.current.values()]
  const tasks = allParts.filter((p): p is TaskPart => p.type === "tool" && p.tool === "task")
  const report = allParts
    .filter((p) => p.messageID === assistantRef.current && p.type === "text")
    .map((p) => (p as Extract<Part, { type: "text" }>).text)
    .join("")

  return (
    <div className="card artifact">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{meta.label}</h2>
        <button className="icon-btn" onClick={onClose}>
          Close
        </button>
      </div>
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
  )
}
