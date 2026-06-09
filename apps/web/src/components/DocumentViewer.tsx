import { useEffect, useRef, useState } from "react"
import { useDocxodus } from "docxodus/react"
import { CommentRenderMode } from "docxodus"
import {
  fetchRedlinedBytes,
  fetchRedlines,
  acceptRedline,
  rejectRedline,
  acceptAllRedlines,
  rejectAllRedlines,
  type Redline,
} from "../api/ingest"

// In-browser redline viewer. Fetches the matter's document with every pending
// redline applied as native tracked changes and converts it to HTML with the WASM
// runtime — insertions render green, deletions struck red, the redline lawyers
// expect. The change list alongside it accepts or rejects each proposal, one block
// at a time or the whole document at once. Bytes convert client-side, so the
// document never leaves the browser for a third-party service.
export default function DocumentViewer({
  matterId,
  name,
  focusId,
  onClose,
  onChanged,
}: {
  matterId: string
  name: string
  // A redline id to scroll to and highlight on open, set when the viewer was
  // opened from a chat redline preview's "View in document" link.
  focusId?: number
  onClose: () => void
  onChanged?: () => void
}) {
  const { isReady, error: wasmError, convertToHtml } = useDocxodus("/wasm/")
  const [html, setHtml] = useState<string>()
  const [redlines, setRedlines] = useState<Redline[]>([])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<number | "all">()
  // Bumped after an accept/reject resolves so the load effect re-runs — the
  // document re-renders and the change list shrinks without duplicating fetch logic.
  const [reload, setReload] = useState(0)
  const focusRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isReady) return
    let cancelled = false
    setHtml(undefined)
    setError(undefined)
    Promise.all([fetchRedlinedBytes(matterId, name), fetchRedlines(matterId, name)])
      .then(async ([bytes, changes]) => {
        const out = await convertToHtml(bytes, {
          renderTrackedChanges: true,
          showDeletedContent: true,
          renderMoveOperations: true,
          renderHeadersAndFooters: true,
          commentRenderMode: CommentRenderMode.Margin,
        })
        if (cancelled) return
        setHtml(out)
        setRedlines(changes)
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [isReady, matterId, name, reload])

  // Once the change list has rendered, scroll the proposal the chat link pointed
  // at into view and highlight it, so the lawyer lands on that exact change rather
  // than the top of a long list.
  useEffect(() => {
    if (focusId !== undefined) focusRef.current?.scrollIntoView({ block: "center" })
  }, [focusId, redlines])

  async function resolve(action: () => Promise<void>, key: number | "all") {
    setBusy(key)
    try {
      await action()
      onChanged?.()
      setReload((n) => n + 1)
    } finally {
      setBusy(undefined)
    }
  }

  // Download the redlined .docx — the document with pending changes as native Word
  // tracked changes — so it can be sent to counsel to accept or reject in Word.
  // With nothing pending this is simply the current clean document.
  async function download() {
    const bytes = await fetchRedlinedBytes(matterId, name)
    const url = URL.createObjectURL(
      new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    )
    const a = document.createElement("a")
    a.href = url
    a.download = redlines.length ? `${name.replace(/\.docx$/i, "")} (tracked changes).docx` : name
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="viewer-overlay" onClick={onClose}>
      <div className="viewer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-bar">
          <span className="viewer-title">{name}</span>
          <div className="viewer-bar-actions">
            <button onClick={download} disabled={!html} title="Download as a Word file with tracked changes">
              {redlines.length ? "Download redline" : "Download"}
            </button>
            <button onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="viewer-body">
          <div className="viewer-doc">
            {wasmError && <p className="muted">Viewer failed to load: {wasmError.message}</p>}
            {error && <p className="muted">{error}</p>}
            {!wasmError && !error && !html && (
              <p className="muted">{isReady ? `Rendering ${name}...` : "Loading viewer..."}</p>
            )}
            {html && <div className="docx-render" dangerouslySetInnerHTML={{ __html: html }} />}
          </div>
          {redlines.length > 0 && (
            <aside className="changes-panel">
              <div className="changes-head">
                <span>
                  {redlines.length} pending change{redlines.length === 1 ? "" : "s"}
                </span>
                <div className="changes-actions">
                  <button
                    className="btn-accept"
                    disabled={busy !== undefined}
                    onClick={() => resolve(() => acceptAllRedlines(matterId, name), "all")}
                  >
                    Accept all
                  </button>
                  <button
                    className="btn-reject"
                    disabled={busy !== undefined}
                    onClick={() => resolve(() => rejectAllRedlines(matterId, name), "all")}
                  >
                    Reject all
                  </button>
                </div>
              </div>
              {redlines.map((r) => (
                <div
                  className={`change-card${r.id === focusId ? " focused" : ""}`}
                  key={r.id}
                  ref={r.id === focusId ? focusRef : undefined}
                >
                  <div className="change-author">{r.author}</div>
                  {r.old_text && <div className="change-old">{r.old_text}</div>}
                  <div className="change-new">{r.new_text}</div>
                  <div className="change-buttons">
                    <button
                      className="btn-accept"
                      disabled={busy !== undefined}
                      onClick={() => resolve(() => acceptRedline(matterId, r.id), r.id)}
                    >
                      {busy === r.id ? "..." : "Accept"}
                    </button>
                    <button
                      className="btn-reject"
                      disabled={busy !== undefined}
                      onClick={() => resolve(() => rejectRedline(matterId, r.id), r.id)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
