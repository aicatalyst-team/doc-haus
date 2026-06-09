import { useState } from "react"

type Agent = { name: string; description?: string; mode?: string }

// Lawyer-facing names for the primary agents. The agent ids are config-level
// plumbing; the lawyer picks how the assistant behaves, not a model.
const LABELS: Record<string, string> = {
  qa: "Q&A",
  "legal-review": "Full review",
}

// Plain-language blurbs shown beside each assistant. Presentation-only — the
// config descriptions stay as-is so agent routing is unaffected; these just read
// better to a lawyer than the orchestration wording the agents carry.
const DESCRIPTIONS: Record<string, string> = {
  qa: "Answers questions about this matter's documents, always with citations.",
  "legal-review": "Reads every document and returns one combined report from a reviewer, challenger, and summarizer.",
}

function label(name: string) {
  return LABELS[name] ?? name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

// Lets the user pick which primary agent answers chat. Agent definitions carry
// their own model, so picking the agent is the model/behavior selector. A link
// opens a modal that lists each assistant with its description, rather than a
// bare dropdown — the choice reads in plain terms.
export default function ModelSelector({
  agents,
  value,
  onChange,
}: {
  agents: Agent[]
  value: string
  onChange: (name: string) => void
}) {
  const primary = agents.filter((a) => a.mode !== "subagent")
  const [open, setOpen] = useState(false)
  if (primary.length === 0) return null

  return (
    <>
      <button className="linklike assistant-trigger" onClick={() => setOpen(true)}>
        Assistant: {label(value)}
      </button>
      {open && (
        <div className="viewer-overlay" onClick={() => setOpen(false)}>
          <div className="picker-panel" onClick={(e) => e.stopPropagation()}>
            <div className="viewer-bar">
              <span className="viewer-title">Choose an assistant</span>
              <button onClick={() => setOpen(false)}>Close</button>
            </div>
            <div className="picker-body">
              {primary.map((a) => (
                <button
                  key={a.name}
                  className={`assistant-option${a.name === value ? " selected" : ""}`}
                  onClick={() => {
                    onChange(a.name)
                    setOpen(false)
                  }}
                >
                  <span className="assistant-name">{label(a.name)}</span>
                  <span className="assistant-desc muted">{DESCRIPTIONS[a.name] ?? a.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
