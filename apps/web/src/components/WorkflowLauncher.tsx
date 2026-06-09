import { useState } from "react"
import { WORKFLOWS } from "../agents"

// "Workflows" control by the composer. Opens a modal of the multi-step routines
// available for this matter; picking one launches it into the artifact panel.
export default function WorkflowLauncher({
  available,
  onLaunch,
}: {
  available: Set<string>
  onLaunch: (name: string) => void
}) {
  const options = WORKFLOWS.filter((w) => available.has(w.name))
  const [open, setOpen] = useState(false)
  if (options.length === 0) return null

  return (
    <>
      <button className="workflow-btn" onClick={() => setOpen(true)}>
        Workflows
      </button>
      {open && (
        <div className="viewer-overlay" onClick={() => setOpen(false)}>
          <div className="picker-panel" onClick={(e) => e.stopPropagation()}>
            <div className="viewer-bar">
              <span className="viewer-title">Workflows</span>
              <button onClick={() => setOpen(false)}>Close</button>
            </div>
            <div className="picker-body">
              {options.map((w) => (
                <button
                  key={w.name}
                  className="assistant-option"
                  onClick={() => {
                    onLaunch(w.name)
                    setOpen(false)
                  }}
                >
                  <span className="assistant-name">{w.label}</span>
                  <span className="assistant-desc muted">{w.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
