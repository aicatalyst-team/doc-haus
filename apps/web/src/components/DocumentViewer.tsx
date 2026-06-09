import { useEffect, useState } from "react"
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
  onClose,
  onChanged,
}: {
  matterId: string
  name: string
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

  return (
    <div className="viewer-overlay" onClick={onClose}>
      <div className="viewer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-bar">
          <span className="viewer-title">{name}</span>
          <button onClick={onClose}>Close</button>
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
                <div className="change-card" key={r.id}>
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
