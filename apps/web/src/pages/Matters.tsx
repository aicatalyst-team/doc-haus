import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import {
  createMatter,
  deleteMatter,
  listMatters,
  listJurisdictions,
  renameMatter,
  type Matter,
  type Jurisdiction,
} from "../api/ingest"
import JurisdictionSelect from "../components/JurisdictionSelect"
import { useToast } from "../components/Toast"

export default function Matters() {
  const [matters, setMatters] = useState<Matter[]>([])
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([])
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState("")
  const [reference, setReference] = useState("")
  const [filter, setFilter] = useState("")
  const [busy, setBusy] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  // The matter being edited in the modal, plus its draft fields. null when closed.
  const [editing, setEditing] = useState<Matter | null>(null)
  const [draftTitle, setDraftTitle] = useState("")
  const [draftReference, setDraftReference] = useState("")
  const [draftJurisdictions, setDraftJurisdictions] = useState<string[]>([])
  const toast = useToast()

  useEffect(() => {
    listMatters()
      .then(setMatters)
      .finally(() => setLoading(false))
    listJurisdictions().then(setJurisdictions)
  }, [])

  useEffect(() => {
    if (!confirmId) return
    const dismiss = () => setConfirmId(null)
    window.addEventListener("click", dismiss)
    return () => window.removeEventListener("click", dismiss)
  }, [confirmId])

  async function onCreate() {
    if (!title.trim()) return
    setBusy(true)
    const matter = await createMatter(title.trim(), reference.trim() || undefined, undefined)
    setMatters((prev) => [...prev, matter])
    setTitle("")
    setReference("")
    setBusy(false)
    toast("success", `Created matter "${matter.title}".`)
  }

  async function onDelete(m: Matter) {
    setConfirmId(null)
    await deleteMatter(m.id)
    setMatters((prev) => prev.filter((x) => x.id !== m.id))
    toast("success", `Deleted matter "${m.title}".`)
  }

  function openEdit(m: Matter) {
    setEditing(m)
    setDraftTitle(m.title)
    setDraftReference(m.reference ?? "")
    setDraftJurisdictions(m.jurisdictions ?? [])
  }

  async function onSaveEdit() {
    if (!editing || !draftTitle.trim()) return
    setBusy(true)
    const updated = await renameMatter(
      editing.id,
      draftTitle.trim(),
      draftReference.trim() || undefined,
      draftJurisdictions.length ? draftJurisdictions : undefined,
      editing.playbook,
    )
    setMatters((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
    setEditing(null)
    setBusy(false)
    toast("success", `Updated matter "${updated.title}".`)
  }

  const term = filter.trim().toLowerCase()
  const visible = [...matters]
    .sort((a, b) => b.created_at - a.created_at)
    .filter((m) => !term || m.title.toLowerCase().includes(term) || (m.reference ?? "").toLowerCase().includes(term))

  return (
    <>
      <div className="card">
        <h2>New matter</h2>
        <div className="row">
          <input
            placeholder="Matter title, e.g. Acme MSA review"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onCreate()}
            style={{ flex: 1 }}
          />
          <input
            placeholder="Matter ID (optional)"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onCreate()}
            style={{ width: 160 }}
          />
          <button className="primary" onClick={onCreate} disabled={busy || !title.trim()}>
            Create matter
          </button>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Matters</h2>
          {matters.length > 0 && (
            <input
              placeholder="Filter by title or ID"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ width: 220 }}
            />
          )}
        </div>
        {loading ? (
          <p className="muted">Loading matters...</p>
        ) : matters.length === 0 ? (
          <p className="muted">No matters yet. Create one to begin.</p>
        ) : visible.length === 0 ? (
          <p className="muted">No matters match "{filter}".</p>
        ) : (
          <ul className="matter-list">
            {visible.map((m) => (
              <li key={m.id}>
                {m.reference && <span className="matter-ref">{m.reference}</span>}
                <Link to={`/matter/${m.id}`} style={{ flex: 1 }}>
                  {m.title}
                </Link>
                {m.jurisdictions?.map((code) => (
                  <span key={code} className="matter-ref">
                    {code}
                  </span>
                ))}
                <span className="muted">{new Date(m.created_at).toLocaleDateString()}</span>
                <button className="icon-btn" title="Edit matter" onClick={() => openEdit(m)}>
                  Edit
                </button>
                {confirmId === m.id ? (
                  <button
                    className="icon-btn danger"
                    title="Confirm delete"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(m)
                    }}
                  >
                    Confirm
                  </button>
                ) : (
                  <button
                    className="icon-btn"
                    title="Delete matter"
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmId(m.id)
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

      {editing && (
        <div className="viewer-overlay" onClick={() => setEditing(null)}>
          <div className="picker-panel matter-edit" onClick={(e) => e.stopPropagation()}>
            <div className="viewer-bar">
              <span className="viewer-title">Edit matter</span>
              <button onClick={() => setEditing(null)}>Close</button>
            </div>
            <div className="matter-edit-body">
              <label className="matter-edit-field">
                <span>Title</span>
                <input
                  autoFocus
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSaveEdit()}
                />
              </label>
              <label className="matter-edit-field">
                <span>Matter ID</span>
                <input
                  value={draftReference}
                  onChange={(e) => setDraftReference(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSaveEdit()}
                />
              </label>
              <div className="matter-edit-field">
                <span>Jurisdictions</span>
                <JurisdictionSelect
                  jurisdictions={jurisdictions}
                  selected={draftJurisdictions}
                  onChange={setDraftJurisdictions}
                />
              </div>
            </div>
            <div className="viewer-bar matter-edit-foot">
              <button onClick={() => setEditing(null)}>Cancel</button>
              <button className="primary" onClick={onSaveEdit} disabled={busy || !draftTitle.trim()}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
