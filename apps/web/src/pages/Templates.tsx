import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import {
  deleteTemplate,
  listTemplates,
  updateTemplateDescription,
  uploadTemplate,
  type Template,
} from "../api/ingest"
import { useToast } from "../components/Toast"
import TemplateViewer from "../components/TemplateViewer"
import ChatPanel from "../components/ChatPanel"
import { TEMPLATE_BUILDER } from "../agents"

// The firm's global template library: the drafting bases shared across every
// matter. A card lists the templates with an editable one-line description and a
// placeholder count, a View button that opens the template in a read-only viewer,
// an inline Confirm delete, and a .docx-only dropzone to add one. Beside it the
// Template Builder chat composes and maintains templates conversationally — it
// runs in the library directory (there is no matter to scope to), pinned to the
// template-builder agent. Templates are also created by the matter drafter; this
// page manages the uploaded and seeded ones directly.
export default function Templates() {
  const [params, setParams] = useSearchParams()
  const session = params.get("session") ?? undefined
  const [dir, setDir] = useState<string>()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmName, setConfirmName] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [viewing, setViewing] = useState<Template>()
  const input = useRef<HTMLInputElement>(null)
  // The session id the composer just minted, so the remount that follows the first
  // send keeps the cursor seated (same pattern as MatterDetail).
  const createdRef = useRef<string | undefined>(undefined)
  const toast = useToast()

  function refresh() {
    return listTemplates().then((res) => {
      setDir(res.dir)
      setTemplates(res.templates)
    })
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!confirmName) return
    const dismiss = () => setConfirmName(null)
    window.addEventListener("click", dismiss)
    return () => window.removeEventListener("click", dismiss)
  }, [confirmName])

  async function onFiles(files: File[]) {
    const docx = files.filter((f) => f.name.toLowerCase().endsWith(".docx"))
    if (!docx.length) {
      toast("error", "Templates must be .docx files.")
      return
    }
    setBusy(true)
    for (const file of docx) {
      const template = await uploadTemplate(file)
      setTemplates((prev) => [...prev.filter((t) => t.name !== template.name), template])
      toast("success", `Added template "${template.name}".`)
    }
    setBusy(false)
  }

  async function onDelete(t: Template) {
    setConfirmName(null)
    await deleteTemplate(t.name)
    setTemplates((prev) => prev.filter((x) => x.name !== t.name))
    toast("success", `Deleted template "${t.name}".`)
  }

  async function saveDescription(t: Template, description: string) {
    setEditing(null)
    if (description === t.description) return
    try {
      const updated = await updateTemplateDescription(t.name, description)
      setTemplates((prev) => prev.map((x) => (x.name === t.name ? { ...x, description: updated.description } : x)))
      toast("success", `Updated description for "${t.name}".`)
    } catch {
      toast("error", `Could not update description for "${t.name}".`)
    }
  }

  const visible = [...templates].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <>
      <div className="card">
        <h2>Add template</h2>
        <div
          className="dropzone"
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const files = Array.from(e.dataTransfer.files)
            if (files.length) onFiles(files)
          }}
        >
          {busy ? "Working..." : "Drop a .docx template here, or click to choose a file."}
        </div>
        <input
          ref={input}
          type="file"
          accept=".docx"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length) onFiles(files)
            e.target.value = ""
          }}
        />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Templates</h2>
        {loading ? (
          <p className="muted">Loading templates...</p>
        ) : templates.length === 0 ? (
          <p className="muted">No templates yet. Add one to begin.</p>
        ) : (
          <ul className="matter-list">
            {visible.map((t) => (
              <li key={t.name}>
                <span style={{ flex: 1 }}>{t.name}</span>
                {editing === t.name ? (
                  <input
                    className="template-desc-input"
                    autoFocus
                    defaultValue={t.description}
                    placeholder="Add description"
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => saveDescription(t, e.target.value.trim())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur()
                      if (e.key === "Escape") setEditing(null)
                    }}
                  />
                ) : (
                  <span
                    className="muted template-desc"
                    title="Click to edit description"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditing(t.name)
                    }}
                  >
                    {t.description || "Add description"}
                  </span>
                )}
                <span className="muted template-count">
                  {t.placeholders.length} placeholder{t.placeholders.length === 1 ? "" : "s"}
                </span>
                <button
                  className="icon-btn"
                  title="View template"
                  onClick={(e) => {
                    e.stopPropagation()
                    setViewing(t)
                  }}
                >
                  View
                </button>
                {confirmName === t.name ? (
                  <button
                    className="icon-btn danger"
                    title="Confirm delete"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(t)
                    }}
                  >
                    Confirm
                  </button>
                ) : (
                  <button
                    className="icon-btn"
                    title="Delete template"
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmName(t.name)
                    }}
                  >
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {dir && (
        <ChatPanel
          key={session ?? "new"}
          directory={dir}
          sessionID={session}
          created={createdRef.current === session}
          agent={TEMPLATE_BUILDER.name}
          available={new Set([TEMPLATE_BUILDER.name])}
          pinned={TEMPLATE_BUILDER}
          title="Ask the template library"
          emptyHint="Describe a template to add to the firm's library, or ask what already exists. Templates carry [insert ...] placeholders instead of client details."
          starters={[
            "What templates do we have?",
            "Create a template for a consulting agreement.",
            "Create a template for an employment offer letter.",
          ]}
          composerPlaceholder="e.g. Create a template for a mutual NDA"
          onAgentChange={() => {}}
          onSessionCreated={(sid) => {
            createdRef.current = sid
            setParams({ session: sid }, { replace: true })
          }}
          onViewDocument={() => {}}
          onDocumentsChanged={refresh}
        />
      )}

      {viewing && (
        <TemplateViewer
          name={viewing.name}
          placeholders={viewing.placeholders}
          onClose={() => setViewing(undefined)}
        />
      )}
    </>
  )
}
