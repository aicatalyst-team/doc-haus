import { useEffect, useState } from "react"
import { useDocxodus } from "docxodus/react"
import { fetchTemplateBytes, type TemplatePlaceholder } from "../api/ingest"

// In-browser template viewer. Renders a library template's .docx to HTML with the
// WASM runtime and lists the placeholders a draft would fill, so the lawyer reads
// the template body without the matter/redline machinery the document viewer
// carries — a template is a clean drafting base, never redlined. Bytes convert
// client-side, so the file never leaves the browser for a third-party service.
export default function TemplateViewer({
  name,
  placeholders,
  onClose,
}: {
  name: string
  placeholders: TemplatePlaceholder[]
  onClose: () => void
}) {
  const { isReady, error: wasmError, convertToHtml } = useDocxodus("/wasm/")
  const [html, setHtml] = useState<string>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!isReady) return
    let cancelled = false
    setHtml(undefined)
    setError(undefined)
    fetchTemplateBytes(name)
      .then(async (bytes) => {
        const out = await convertToHtml(bytes, { renderHeadersAndFooters: true })
        if (!cancelled) setHtml(out)
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [isReady, name])

  return (
    <div className="viewer-overlay" onClick={onClose}>
      <div className="viewer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-bar">
          <span className="viewer-title">{name}</span>
          <div className="viewer-bar-actions">
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
          <aside className="changes-panel">
            <div className="changes-head">
              <span>
                {placeholders.length} placeholder{placeholders.length === 1 ? "" : "s"}
              </span>
            </div>
            {placeholders.length === 0 ? (
              <p className="muted">This template exposes no placeholders.</p>
            ) : (
              <ul className="template-placeholders">
                {placeholders.map((p) => (
                  <li key={p.text}>{p.text}</li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
