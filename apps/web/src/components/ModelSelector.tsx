import { useState } from "react"
import { CHAT_ASSISTANTS } from "../agents"

// Picks who answers in the chat — a stateful mode selector (Q&A, Redline), like a
// model picker. The choice persists across messages and is reflected in the chip.
// Workflows are one-shot actions, not modes, so they live in their own launcher
// rather than this list. `available` is the set of agent ids the engine actually
// has, so we never offer one that is not installed.
export default function ModelSelector({
  available,
  value,
  onChange,
}: {
  available: Set<string>
  value: string
  onChange: (name: string) => void
}) {
  const assistants = CHAT_ASSISTANTS.filter((a) => available.has(a.name))
  const [open, setOpen] = useState(false)
  if (assistants.length === 0) return null

  const current = assistants.find((a) => a.name === value) ?? assistants[0]
  return (
    <>
      <button className="assistant-trigger" onClick={() => setOpen(true)} title="Choose assistant or workflow">
        <svg className="assistant-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
          <path d="M20 3v4M22 5h-4M4 17v2M5 18H3" />
        </svg>
        <span className="assistant-trigger-label">{current.label}</span>
        <svg className="assistant-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="viewer-overlay" onClick={() => setOpen(false)}>
          <div className="picker-panel" onClick={(e) => e.stopPropagation()}>
            <div className="viewer-bar">
              <span className="viewer-title">Choose an assistant</span>
              <button onClick={() => setOpen(false)}>Close</button>
            </div>
            <div className="picker-body">
              {assistants.map((a) => (
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
