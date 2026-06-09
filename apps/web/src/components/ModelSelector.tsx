import { useState } from "react"
import { CHAT_ASSISTANTS } from "../agents"

// Assistant picker: a quiet link in the chat header opens a modal listing each
// chat assistant we expose, with its description, rather than a bare dropdown of
// every agent the engine happens to load. `available` is the set of agent ids the
// engine actually has, so we never offer one that is not installed.
export default function ModelSelector({
  available,
  value,
  onChange,
}: {
  available: Set<string>
  value: string
  onChange: (name: string) => void
}) {
  const options = CHAT_ASSISTANTS.filter((a) => available.has(a.name))
  const [open, setOpen] = useState(false)
  if (options.length === 0) return null

  const current = options.find((a) => a.name === value) ?? options[0]
  return (
    <>
      <button className="linklike assistant-trigger" onClick={() => setOpen(true)}>
        Assistant: {current.label}
      </button>
      {open && (
        <div className="viewer-overlay" onClick={() => setOpen(false)}>
          <div className="picker-panel" onClick={(e) => e.stopPropagation()}>
            <div className="viewer-bar">
              <span className="viewer-title">Choose an assistant</span>
              <button onClick={() => setOpen(false)}>Close</button>
            </div>
            <div className="picker-body">
              {options.map((a) => (
                <button
                  key={a.name}
                  className={`assistant-option${a.name === value ? " selected" : ""}`}
                  onClick={() => {
                    onChange(a.name)
                    setOpen(false)
                  }}
                >
                  <span className="assistant-name">{a.label}</span>
                  <span className="assistant-desc muted">{a.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
