import { useEffect, useRef, useState } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { getMatter, renameMatter, listJurisdictions, type MatterDetail as Detail, type Jurisdiction } from "../api/ingest"
import { listAgents, matterClient } from "../api/opencode"
import { AUTO } from "../agents"
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
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [agent, setAgent] = useState(AUTO)
  const [viewing, setViewing] = useState<string>()
  // The redline proposal to scroll to when the viewer opens, set when the user
  // follows a chat redline preview's "View in document" link (undefined otherwise).
  const [focusRedline, setFocusRedline] = useState<number>()
  const [docsOpen, setDocsOpen] = useState(() => localStorage.getItem("dh.docs") !== "0")
  // Click the title to rename: swap the heading for an input seeded with the
  // current title. Commit persists via the ingest service and updates in place.
  const [renaming, setRenaming] = useState(false)
  const [draftTitle, setDraftTitle] = useState("")
  // The session id the composer just minted. The first send flips the `session`
  // param, remounting ChatPanel under the new id; this lets that remount know it
  // is the same composer (not a rail reopen) so it keeps the cursor seated.
  const createdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    localStorage.setItem("dh.docs", docsOpen ? "1" : "0")
  }, [docsOpen])

  function refresh() {
    if (id) getMatter(id).then(setMatter)
  }

  useEffect(refresh, [id])

  useEffect(() => {
    listJurisdictions().then(setJurisdictions)
  }, [])

  // Change the matter's jurisdiction in place. Reuses the rename endpoint (it
  // patches matter.json), passing the current title/reference so only the
  // jurisdiction moves. The engine reads matter.json each turn, so the next
  // message already reasons under the new jurisdiction.
  async function changeJurisdiction(code: string) {
    if (!matter) return
    await renameMatter(matter.id, matter.title, matter.reference, code || undefined)
    setMatter((m) => m && { ...m, jurisdiction: code || undefined })
  }

  useEffect(() => {
    if (!matter) return
    const dir = matter.dir
    let cancelled = false
    // Right after navigating back into a matter the engine can be briefly busy and
    // app.agents() rejects. The assistant and workflow pickers hide when they have
    // no agents to offer (see ModelSelector/WorkflowLauncher), so a single failed
    // call would silently drop the composer controls for the whole mount. Retry
    // until it answers rather than leaving them missing.
    async function load() {
      while (!cancelled) {
        const list = await listAgents(matterClient(dir)).catch(() => undefined)
        if (cancelled) return
        if (list) {
          setAgents(list as Agent[])
          // A new chat opens on Auto (a pseudo-assistant always offered, so no
          // availability check); an existing session restores the agent it last
          // used (see ChatPanel's load effect), so don't force Auto here. When a
          // surface deep-links in with an `agent` param (e.g. "Save as template"
          // pinning the drafter), honour it if it is a real assistant — this must
          // live in this effect or the unconditional setAgent(AUTO) clobbers it.
          if (!session) {
            const pinned = params.get("agent")
            setAgent(pinned && (list as Agent[]).some((a) => a.name === pinned) ? pinned : AUTO)
          }
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // Re-run when the deep-linked agent param changes (e.g. "Save as template"
    // pins the drafter while already in the matter) so the pin is honoured even
    // though `matter` is unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matter, params.get("agent")])

  if (!matter) return <p className="muted">Loading matter...</p>

  const available = new Set(agents.map((a) => a.name))

  async function commitRename() {
    setRenaming(false)
    const next = draftTitle.trim()
    if (!matter || !next || next === matter.title) return
    const updated = await renameMatter(matter.id, next, matter.reference, matter.jurisdiction)
    setMatter((m) => m && { ...m, title: updated.title })
    onSessionsChanged()
  }

  return (
    <>
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
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
        {jurisdictions.length > 0 && (
          <select
            value={matter.jurisdiction ?? ""}
            onChange={(e) => changeJurisdiction(e.target.value)}
            title="Jurisdiction — steers reasoning and citation style"
            style={{ marginLeft: "auto" }}
          >
            <option value="">No jurisdiction</option>
            {jurisdictions.map((j) => (
              <option key={j.code} value={j.code}>
                {j.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {view === "chat" && (
        <div className={`matter-body${docsOpen ? "" : " docs-collapsed"}`}>
          <div className="workspace">
            <ChatPanel
              key={session ?? "new"}
              directory={matter.dir}
              sessionID={session}
              created={createdRef.current === session}
              initialPrompt={params.get("prompt") ?? undefined}
              agent={agent}
              available={available}
              onAgentChange={setAgent}
              onSessionCreated={(sid) => {
                createdRef.current = sid
                setParams({ view: "chat", session: sid }, { replace: true })
              }}
              onSessionStarted={onSessionsChanged}
              onViewDocument={(name, redlineId) => {
                setFocusRedline(redlineId)
                setViewing(name)
              }}
              onDocumentsChanged={refresh}
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
          onSaveTemplate={
            viewing.toLowerCase().endsWith(".docx")
              ? () => {
                  const doc = viewing
                  setViewing(undefined)
                  setParams({
                    view: "chat",
                    agent: "drafter",
                    prompt: `Save "${doc}" as a reusable template. Read the document and replace every party name, date, amount, address, and other client-specific detail with a unique [insert ...] placeholder, then save it to the template library.`,
                  })
                }
              : undefined
          }
        />
      )}
    </>
  )
}
