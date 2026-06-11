import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { deleteAgent, listAgents, type AgentRecord } from "../api/ingest"
import { useToast } from "../components/Toast"
import ChatPanel from "../components/ChatPanel"
import { DocMarkdown } from "../components/Markdown"
import { AGENT_BUILDER } from "../agents"

// The firm's specialist subagents: the repo-shipped reviewers (read-only) plus
// the custom ones composed conversationally by the agent-builder. A custom
// specialist analyzes a matter's documents for one concern and reports cited
// findings; it becomes a workflow pipeline step the moment it is created.
// Beside the list the Agent Builder chat composes and maintains specialists —
// it runs in the agent library directory (there is no matter to scope to),
// pinned to the agent-builder agent. Deleting an agent a workflow still uses is
// refused by the registry, with the workflows named in the error.
export default function Agents() {
  const [params, setParams] = useSearchParams()
  const session = params.get("session") ?? undefined
  const [dir, setDir] = useState<string>()
  const [agents, setAgents] = useState<AgentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmName, setConfirmName] = useState<string | null>(null)
  const [viewing, setViewing] = useState<AgentRecord>()
  const createdRef = useRef<string | undefined>(undefined)
  const toast = useToast()

  function refresh() {
    return listAgents().then((res) => {
      setDir(res.dir)
      setAgents(res.agents)
    })
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!confirmName) return
    const dismiss = () => setConfirmName(null)
    window.addEventListener("click", dismiss)
    return () => window.removeEventListener("click", dismiss)
  }, [confirmName])

  async function onDelete(a: AgentRecord) {
    setConfirmName(null)
    try {
      await deleteAgent(a.name)
      setAgents((prev) => prev.filter((x) => x.name !== a.name))
      toast("success", `Deleted agent "${a.label}".`)
    } catch (e) {
      toast("error", e instanceof Error ? e.message : `Could not delete ${a.name}.`)
    }
  }

  const visible = [...agents].sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name))

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Agents</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Specialist reviewers that analyze a matter's documents for one concern. Compose them into pipelines from the
          Workflows page.
        </p>
        {loading ? (
          <p className="muted">Loading agents...</p>
        ) : (
          <ul className="matter-list">
            {visible.map((a) => (
              <li key={a.name}>
                <div className="template-info">
                  <span className="template-name">{a.label}</span>
                  <span className="muted template-desc">{a.description}</span>
                </div>
                {a.builtin && <span className="muted template-count">Built-in</span>}
                <button
                  className="icon-btn"
                  title="View agent instructions"
                  onClick={(e) => {
                    e.stopPropagation()
                    setViewing(a)
                  }}
                >
                  View
                </button>
                {!a.builtin &&
                  (confirmName === a.name ? (
                    <button
                      className="icon-btn danger"
                      title="Confirm delete"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(a)
                      }}
                    >
                      Confirm
                    </button>
                  ) : (
                    <button
                      className="icon-btn"
                      title="Delete agent"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmName(a.name)
                      }}
                    >
                      Delete
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </div>

      {dir && (
        <ChatPanel
          key={session ?? "new"}
          directory={dir}
          sessionID={session}
          created={createdRef.current === session}
          agent={AGENT_BUILDER.name}
          available={new Set([AGENT_BUILDER.name])}
          pinned={AGENT_BUILDER}
          title="Ask the agent builder"
          emptyHint="Describe a specialist reviewer to add to the firm's agents, or ask what already exists. New specialists become workflow steps immediately."
          starters={[
            "What agents do we have?",
            "Create a specialist that reviews IP ownership and assignment clauses.",
            "Create a specialist that checks data privacy and GDPR exposure.",
          ]}
          composerPlaceholder="e.g. Create a specialist for change-of-control provisions"
          onAgentChange={() => {}}
          onSessionCreated={(sid) => {
            createdRef.current = sid
            setParams({ session: sid }, { replace: true })
          }}
          onViewDocument={() => {}}
          onDocumentsChanged={refresh}
        />
      )}

      {viewing && (
        <div className="viewer-overlay" onClick={() => setViewing(undefined)}>
          <div className="picker-panel doc-panel" onClick={(e) => e.stopPropagation()}>
            <div className="viewer-bar">
              <span className="viewer-title">
                {viewing.label}
                {viewing.builtin ? " (built-in)" : ""}
              </span>
              <button onClick={() => setViewing(undefined)}>Close</button>
            </div>
            <div className="picker-body">
              {viewing.description && <p className="muted">{viewing.description}</p>}
              <DocMarkdown>{viewing.instructions}</DocMarkdown>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
