type Agent = { name: string; description?: string; mode?: string }

// Lawyer-facing names for the primary agents. The agent ids are config-level
// plumbing; the lawyer picks how the assistant behaves, not a model.
const LABELS: Record<string, string> = {
  qa: "Q&A",
  "legal-review": "Full review",
}

// Plain-language blurbs shown under the picker. Presentation-only — the config
// descriptions stay as-is so agent routing is unaffected; these just read better
// to a lawyer than the orchestration wording the agents carry.
const DESCRIPTIONS: Record<string, string> = {
  qa: "Answers questions about this matter's documents, always with citations.",
  "legal-review": "Reads every document and returns one combined report from a reviewer, challenger, and summarizer.",
}

function label(name: string) {
  return LABELS[name] ?? name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

// Lets the user pick which primary agent answers chat. Agent definitions carry
// their own model, so picking the agent is the model/behavior selector —
// OpenCode's inherited per-agent model config does the rest. We surface the
// agent's own description so the choice reads in plain terms.
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
  if (primary.length <= 1) return null
  const selected = primary.find((a) => a.name === value)
  const description = DESCRIPTIONS[value] ?? selected?.description
  return (
    <div className="agent-select">
      <label className="row" style={{ gap: 6 }}>
        <span className="muted">Assistant</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {primary.map((a) => (
            <option key={a.name} value={a.name}>
              {label(a.name)}
            </option>
          ))}
        </select>
      </label>
      {description && <p className="agent-desc muted">{description}</p>}
    </div>
  )
}
