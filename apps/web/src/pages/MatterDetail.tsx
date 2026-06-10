import { useEffect, useState } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { getMatter, renameMatter, type MatterDetail as Detail } from "../api/ingest"
import { listAgents, matterClient } from "../api/opencode"
import DocumentUpload from "../components/DocumentUpload"
import DocumentViewer from "../components/DocumentViewer"
import ChatPanel from "../components/ChatPanel"
import ReviewGrid from "../components/ReviewGrid"

type Agent = { name: string; description?: string; mode?: string }

// One matter, three surfaces, switched by the `view` query param from the
// sidebar: chat | review | documents. The content is a single canvas whose width
// flexes to the surface — the grid and the documents manager run full-width,
// while chat keeps a documents rail for reference. Default surface is chat.
// Workflows are not a surface: they run as seeded chat sessions in the chat view.
export default function MatterDetail({ onSessionsChanged }: { onSessionsChanged: () => void }) {
  const { id } = useParams<{ id: string }>()
  const [params, setParams] = useSearchParams()
  const view = params.get("view") ?? "chat"
  const session = params.get("session") ?? undefined
  const [matter, setMatter] = useState<Detail>()
  const [agents, setAgents] = useState<Agent[]>([])
  const [agent, setAgent] = useState("qa")
  const [viewing, setViewing] = useState<string>()
  // The redline proposal to scroll to when the viewer opens, set when the user
  // follows a chat redline preview's "View in document" link (undefined otherwise).
  const [focusRedline, setFocusRedline] = useState<number>()
  const [docsOpen, setDocsOpen] = useState(() => localStorage.getItem("dh.docs") !== "0")
  // Click the title to rename: swap the heading for an input seeded with the
  // current title. Commit persists via the ingest service and updates in place.
  const [renaming, setRenaming] = useState(false)
  const [draftTitle, setDraftTitle] = useState("")

  useEffect(() => {
    localStorage.setItem("dh.docs", docsOpen ? "1" : "0")
  }, [docsOpen])

  function refresh() {
    if (id) getMatter(id).then(setMatter)
  }

  useEffect(refresh, [id])

  useEffect(() => {
    if (!matter) return
    listAgents(matterClient(matter.dir)).then((list) => {
      setAgents(list as Agent[])
      // A new chat opens on the default agent; an existing session restores the
      // agent it last used (see ChatPanel's load effect), so don't force qa here.
      if (!session && list.some((a) => (a as Agent).name === "qa")) setAgent("qa")
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matter])

  if (!matter) return <p className="muted">Loading matter...</p>

  const available = new Set(agents.map((a) => a.name))

  async function commitRename() {
    setRenaming(false)
    const next = draftTitle.trim()
    if (!matter || !next || next === matter.title) return
    const updated = await renameMatter(matter.id, next, matter.reference)
    setMatter((m) => m && { ...m, title: updated.title })
    onSessionsChanged()
  }

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        {renaming ? (
          <input
            className="matter-title-input"
            autoFocus
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename()
              if (e.key === "Escape") setRenaming(false)
            }}
          />
        ) : (
          <h2
            className="matter-title"
            style={{ margin: 0 }}
            title="Click to rename"
            onClick={() => {
              setDraftTitle(matter.title)
              setRenaming(true)
            }}
          >
            {matter.reference && <span className="matter-ref">{matter.reference}</span>}
            {matter.title}
          </h2>
        )}
      </div>

      {view === "chat" && (
        <div className={`matter-body${docsOpen ? "" : " docs-collapsed"}`}>
          <div className="workspace">
            <ChatPanel
              key={session ?? "new"}
              directory={matter.dir}
              sessionID={session}
              agent={agent}
              available={available}
              onAgentChange={setAgent}
              onSessionCreated={(sid) => setParams({ view: "chat", session: sid }, { replace: true })}
              onSessionStarted={onSessionsChanged}
              onViewDocument={(name, redlineId) => {
                setFocusRedline(redlineId)
                setViewing(name)
              }}
            />
          </div>
          <DocumentUpload
            matterId={matter.id}
            documents={matter.documents}
            onUploaded={refresh}
            onView={(name) => {
              setFocusRedline(undefined)
              setViewing(name)
            }}
            collapsed={!docsOpen}
            onToggle={() => setDocsOpen((o) => !o)}
          />
        </div>
      )}

      {view === "review" && (
        <ReviewGrid matterId={matter.id} title={matter.title} directory={matter.dir} documents={matter.documents} />
      )}

      {view === "documents" && (
        <DocumentUpload
          matterId={matter.id}
          documents={matter.documents}
          onUploaded={refresh}
          onView={(name) => {
            setFocusRedline(undefined)
            setViewing(name)
          }}
        />
      )}

      {viewing && (
        <DocumentViewer
          matterId={matter.id}
          name={viewing}
          focusId={focusRedline}
          onClose={() => setViewing(undefined)}
          onChanged={refresh}
          onConverted={(name) => setViewing(name)}
        />
      )}
    </>
  )
}
