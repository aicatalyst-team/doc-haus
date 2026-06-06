import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { createMatter, listMatters, type Matter } from "../api/ingest"

export default function Matters() {
  const [matters, setMatters] = useState<Matter[]>([])
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listMatters().then(setMatters)
  }, [])

  async function onCreate() {
    if (!title.trim()) return
    setBusy(true)
    const matter = await createMatter(title.trim())
    setMatters((prev) => [...prev, matter])
    setTitle("")
    setBusy(false)
  }

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
          <button className="primary" onClick={onCreate} disabled={busy || !title.trim()}>
            Create matter
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Matters</h2>
        {matters.length === 0 ? (
          <p className="muted">No matters yet. Create one to begin.</p>
        ) : (
          <ul className="matter-list">
            {matters.map((m) => (
              <li key={m.id}>
                <Link to={`/matter/${m.id}`}>{m.title}</Link>
                <span className="muted">{new Date(m.created_at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
