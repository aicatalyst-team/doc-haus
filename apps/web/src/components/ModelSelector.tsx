type Agent = { name: string; description?: string; mode?: string }

// Lets the user pick which primary agent answers chat. Agent definitions carry
// their own model, so picking the agent is the model/behavior selector —
// OpenCode's inherited per-agent model config does the rest.
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
  return (
    <label className="row" style={{ gap: 6 }}>
      <span className="muted">Agent</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {primary.map((a) => (
          <option key={a.name} value={a.name}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  )
}
