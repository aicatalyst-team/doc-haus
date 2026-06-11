import { useEffect, useRef, useState } from "react"
import type { Jurisdiction } from "../api/ingest"

// A matter can be governed by more than one jurisdiction (a cross-border deal
// touches each party's law), so the picker is a multi-select: a trigger that
// summarises the chosen packs and opens a searchable checklist. With ~30 packs a
// native <select multiple> is unusable, hence the filtered popover.
export default function JurisdictionSelect({
  jurisdictions,
  selected,
  onChange,
  align = "left",
}: {
  jurisdictions: Jurisdiction[]
  selected: string[]
  onChange: (codes: string[]) => void
  align?: "left" | "right"
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState("")
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click so the popover behaves like the native select it
  // replaces. Bound only while open to keep the listener cost off every matter.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener("mousedown", onDown)
    return () => window.removeEventListener("mousedown", onDown)
  }, [open])

  function toggle(code: string) {
    onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code])
  }

  const term = filter.trim().toLowerCase()
  const visible = jurisdictions.filter(
    (j) => !term || j.name.toLowerCase().includes(term) || j.code.toLowerCase().includes(term),
  )
  const label =
    selected.length === 0
      ? "No jurisdiction"
      : selected.length === 1
        ? jurisdictions.find((j) => j.code === selected[0])?.name ?? selected[0]
        : `${selected.length} jurisdictions`

  return (
    <div className="jx-select" ref={ref}>
      <button type="button" className="assistant-trigger jx-trigger" onClick={() => setOpen((o) => !o)} title="Jurisdiction — steers reasoning and citation style">
        <span className="assistant-trigger-label">{label}</span>
        <span className="assistant-caret">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className={`jx-popover${align === "right" ? " jx-right" : ""}`}>
          <input
            className="jx-search"
            autoFocus
            placeholder="Search jurisdictions"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="jx-list">
            {visible.length === 0 ? (
              <p className="muted jx-empty">No match.</p>
            ) : (
              visible.map((j) => (
                <label key={j.code} className={`jx-option${selected.includes(j.code) ? " selected" : ""}`}>
                  <input type="checkbox" checked={selected.includes(j.code)} onChange={() => toggle(j.code)} />
                  <span className="jx-name">{j.name}</span>
                  <span className="matter-ref">{j.code}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
