import { useEffect, useState } from "react"
import { Link, NavLink, useMatch, useNavigate, useSearchParams } from "react-router-dom"
import { getMatter } from "../api/ingest"
import { deleteSession, listSessions, matterClient } from "../api/opencode"
import logo from "../assets/dochaus-logo.svg"
import { useToast } from "./Toast"

type Convo = { id: string; title: string; updated: number }

// The open matter's surfaces, switched by the `view` query param. This rail is
// the single navigation plane: the content area is one canvas per surface.
const SURFACES = [
  { view: "chat", label: "Chat", Icon: IconChat },
  { view: "review", label: "Review", Icon: IconReview },
  { view: "documents", label: "Documents", Icon: IconDocsNav },
] as const

// Left rail. Holds the brand, primary nav, the open matter's conversation
// history, and Settings. Collapses to an icons-only strip; the choice persists
// per browser in localStorage (a single UI preference — no datastore needed).
export default function Sidebar({
  onOpenSettings,
  sessionsVersion,
}: {
  onOpenSettings: () => void
  sessionsVersion: number
}) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("dh.sidebar") === "1")
  const matterId = useMatch("/matter/:id")?.params.id
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const notify = useToast()
  const activeSession = params.get("session")
  const view = params.get("view") ?? "chat"
  const [convos, setConvos] = useState<Convo[]>([])
  const [matterTitle, setMatterTitle] = useState("")
  const [matterDir, setMatterDir] = useState("")
  // The conversation whose delete is armed. Clicking the trash slides out an
  // inline Confirm pill instead of blocking on window.confirm; any click
  // elsewhere disarms it.
  const [confirmId, setConfirmId] = useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem("dh.sidebar", collapsed ? "1" : "0")
  }, [collapsed])

  useEffect(() => {
    if (!confirmId) return
    const dismiss = () => setConfirmId(null)
    window.addEventListener("click", dismiss)
    return () => window.removeEventListener("click", dismiss)
  }, [confirmId])

  // When a matter is open, list its top-level chats (engine-persisted; we only
  // read them). Refetch when the active session changes so a new chat shows up.
  useEffect(() => {
    if (!matterId) return setConvos([])
    let live = true
    getMatter(matterId)
      .then((m) => {
        setMatterTitle(m.title)
        setMatterDir(m.dir)
        return listSessions(matterClient(m.dir))
      })
      .then((list) => {
        if (!live) return
        setConvos(
          list
            // Chats only: drop subagent runs (parentID) and our system-titled
            // sessions — workflow runs and legacy chats carry a "doc.haus" title;
            // real chats are titled from the user's first message.
            .filter((s) => !s.parentID && s.title.trim() && !/^doc\.haus/i.test(s.title))
            .map((s) => ({ id: s.id, title: s.title, updated: s.time.updated }))
            .sort((a, b) => b.updated - a.updated),
        )
      })
    return () => {
      live = false
    }
  }, [matterId, activeSession, sessionsVersion])

  // Delete a conversation from the engine, then drop it from the list. If it was
  // the open one, fall back to a fresh chat so the canvas isn't left on a dead id.
  async function removeConvo(c: Convo) {
    if (!matterDir) return
    setConfirmId(null)
    try {
      await deleteSession(matterClient(matterDir), c.id)
      setConvos((list) => list.filter((x) => x.id !== c.id))
      if (c.id === activeSession) navigate(`/matter/${matterId}?view=chat`)
      notify("success", "Conversation deleted")
    } catch {
      notify("error", "Could not delete conversation")
    }
  }

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="sidebar-brand">
        <Link to="/" title="doc.haus">
          <img src={logo} className="app-logo" alt="" />
          {!collapsed && <span className="wordmark">Doc.Haus</span>}
        </Link>
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/" end className={({ isActive }) => `nav-item${isActive ? " active" : ""}`} title="Matters">
          <IconMatters />
          {!collapsed && <span>Matters</span>}
        </NavLink>
        <NavLink to="/templates" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`} title="Templates">
          <IconTemplates />
          {!collapsed && <span>Templates</span>}
        </NavLink>
        <NavLink to="/workflows" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`} title="Workflows">
          <IconWorkflows />
          {!collapsed && <span>Workflows</span>}
        </NavLink>
        <NavLink to="/skills" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`} title="Skills">
          <IconSkills />
          {!collapsed && <span>Skills</span>}
        </NavLink>
        <NavLink to="/agents" className={({ isActive }) => `nav-item${isActive ? " active" : ""}`} title="Agents">
          <IconAgents />
          {!collapsed && <span>Agents</span>}
        </NavLink>
      </nav>

      {matterId && (
        <div className="sidebar-surfaces">
          {!collapsed && matterTitle && <div className="sidebar-matter">{matterTitle}</div>}
          {SURFACES.map((s) => (
            <Link
              key={s.view}
              to={`/matter/${matterId}?view=${s.view}`}
              className={`nav-item${view === s.view ? " active" : ""}`}
              title={s.label}
            >
              <s.Icon />
              {!collapsed && <span>{s.label}</span>}
            </Link>
          ))}
        </div>
      )}

      {matterId && !collapsed && view === "chat" && (
        <div className="sidebar-convos">
          <div className="sidebar-section-head">
            <span>Conversations</span>
            <Link to={`/matter/${matterId}?view=chat`} className="icon-btn" title="New chat">
              New
            </Link>
          </div>
          {convos.length === 0 ? (
            <p className="muted sidebar-empty">No conversations yet.</p>
          ) : (
            <ul className="convo-list">
              {convos.map((c) => (
                <li key={c.id} className="convo-row">
                  <Link
                    to={`/matter/${matterId}?session=${c.id}`}
                    className={`convo-item${c.id === activeSession ? " active" : ""}`}
                    title={c.title}
                  >
                    {c.title}
                  </Link>
                  {confirmId === c.id ? (
                    <button
                      className="convo-confirm"
                      title="Confirm delete"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeConvo(c)
                      }}
                    >
                      Confirm
                    </button>
                  ) : (
                    <button
                      className="convo-del"
                      title="Delete conversation"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmId(c.id)
                      }}
                    >
                      <IconTrash />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="sidebar-foot">
        <button className="nav-item" onClick={onOpenSettings} title="Settings">
          <IconSettings />
          {!collapsed && <span>Settings</span>}
        </button>
        <button
          className="nav-item"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <IconChevron right={collapsed} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  )
}

function IconChat() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function IconReview() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18" />
    </svg>
  )
}

function IconDocsNav() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

function IconMatters() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}

function IconTemplates() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8M8 11h8M8 15h5" />
    </svg>
  )
}

function IconWorkflows() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="5" cy="12" r="2" />
      <circle cx="19" cy="5" r="2" />
      <circle cx="19" cy="19" r="2" />
      <path d="M7 12h4l3-5" />
      <path d="M11 12l3 5" />
    </svg>
  )
}

function IconSkills() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  )
}

function IconAgents() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="8" width="14" height="11" rx="2" />
      <path d="M12 8V5" />
      <circle cx="12" cy="4" r="1" />
      <path d="M9 13h.01M15 13h.01" />
      <path d="M5 12H3M21 12h-2" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

function IconChevron({ right }: { right: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points={right ? "9 18 15 12 9 6" : "15 18 9 12 15 6"} />
    </svg>
  )
}
