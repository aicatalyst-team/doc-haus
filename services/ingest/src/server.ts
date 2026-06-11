import { Hono } from "hono"
import { cors } from "hono/cors"
import {
  openDb,
  listDocuments,
  deleteDocument,
  listPendingRedlines,
  getRedline,
  setRedlineStatus,
  pendingRedlineCounts,
} from "./db"
import { ingestDocument, extractDocumentText } from "./ingest"
import { pdfToDocx } from "./convert"
import { buildRedlined, bake } from "./redline"
import { listMatters, createMatter, getMatter, renameMatter, deleteMatter, matterDir } from "./matter"
import { seedTemplates, listTemplates, templatePath, setTemplateDescription, removeTemplateDescription, TEMPLATES_DIR } from "./template"
import { docxodus } from "./docxodus"
import { readGrid, writeGrid, type Grid } from "./grid"
import { existsSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

// Seed the global template library from the repo's nda.docx on first boot. The
// directory's existence is the marker, so restarts never re-seed or resurrect a
// deleted template.
seedTemplates()

const app = new Hono()

// Mirror opencode's CORS posture (packages/opencode/src/server/cors.ts): allow
// only localhost/127.0.0.1 origins on any port, not a wildcard. The web app runs
// on localhost; a wildcard would let any site in a user's browser hit this
// service. Non-browser callers (curl, the opencode server) send no Origin and are
// unaffected.
app.use(
  "*",
  cors({ origin: (origin) => (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : null) }),
)

app.get("/matters", (c) => c.json(listMatters()))

app.post("/matters", async (c) => {
  const { title, reference } = await c.req.json<{ title: string; reference?: string }>()
  return c.json(createMatter(title, reference))
})

app.patch("/matters/:id", async (c) => {
  const { title, reference } = await c.req.json<{ title: string; reference?: string }>()
  return c.json(renameMatter(c.req.param("id"), title, reference))
})

app.delete("/matters/:id", (c) => {
  deleteMatter(c.req.param("id"))
  return c.json({ ok: true })
})

app.get("/matters/:id", (c) => {
  const matter = getMatter(c.req.param("id"))
  if (!existsSync(path.join(matter.dir, ".dochaus", "legal.db"))) return c.json({ ...matter, documents: [] })
  const db = openDb(matter.dir)
  const counts = pendingRedlineCounts(db)
  // Surface the pending-redline count per document so the docs rail can badge the
  // documents that have unreviewed changes waiting.
  const documents = (listDocuments(db) as { doc_path: string }[]).map((d) => ({ ...d, pending: counts[d.doc_path] ?? 0 }))
  return c.json({ ...matter, documents })
})

app.post("/matters/:id/documents", async (c) => {
  const dir = matterDir(c.req.param("id"))
  const body = await c.req.parseBody()
  const file = body["file"] as File
  const buffer = Buffer.from(await file.arrayBuffer())
  const result = await ingestDocument(dir, file.name, buffer)
  return c.json(result)
})

// Convert an uploaded .pdf into an editable .docx sibling and index it, so a PDF
// contract can enter the DOCX redline pipeline. The source .pdf is kept; the new
// .docx lands beside it under the same base name. LibreOffice is used when present
// on the host, otherwise a MIT text-only rebuild (see convert.ts).
app.post("/matters/:id/documents/convert", async (c) => {
  const dir = matterDir(c.req.param("id"))
  const name = path.basename(c.req.query("name") ?? "")
  const file = path.join(dir, name)
  if (!name.toLowerCase().endsWith(".pdf") || !existsSync(file)) return c.notFound()
  const docxName = name.replace(/\.pdf$/i, ".docx")
  const result = await ingestDocument(dir, docxName, await pdfToDocx(Buffer.from(await Bun.file(file).bytes())))
  return c.json(result)
})

// Remove a document: delete the source .docx and its index rows. basename()
// keeps the lookup inside the matter directory, matching the content route.
app.delete("/matters/:id/documents", (c) => {
  const dir = matterDir(c.req.param("id"))
  const file = path.join(dir, path.basename(c.req.query("name") ?? ""))
  rmSync(file, { force: true })
  if (existsSync(path.join(dir, ".dochaus", "legal.db"))) deleteDocument(openDb(dir), file)
  return c.json({ ok: true })
})

// The tabular-review grid for a matter: its question-columns and computed cells.
// Rows are the matter's documents, fetched separately, so they are not stored.
app.get("/matters/:id/grid", (c) => c.json(readGrid(matterDir(c.req.param("id")))))

app.put("/matters/:id/grid", async (c) => {
  writeGrid(matterDir(c.req.param("id")), await c.req.json<Grid>())
  return c.json({ ok: true })
})

// Serve a matter's .docx bytes so the web app can render the redline in-browser
// (the viewer converts to HTML client-side via WASM — the file is never uploaded
// anywhere). basename() keeps the lookup inside the matter directory.
app.get("/matters/:id/documents/content", async (c) => {
  const file = path.join(matterDir(c.req.param("id")), path.basename(c.req.query("name") ?? ""))
  if (!existsSync(file)) return c.notFound()
  const mime = file.toLowerCase().endsWith(".pdf")
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  return new Response(Bun.file(file).stream(), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="${path.basename(file)}"`,
    },
  })
})

// The plain text of a matter document, mammoth-extracted (the same text indexing
// uses). The drafter's read-document tool reads it to convert an existing document
// into a template by replacing every client-specific detail with a placeholder.
app.get("/matters/:id/documents/text", async (c) => {
  const file = path.join(matterDir(c.req.param("id")), path.basename(c.req.query("name") ?? ""))
  if (!existsSync(file)) return c.notFound()
  return c.json({ text: await extractDocumentText(file, Buffer.from(await Bun.file(file).bytes())) })
})

// The global template library. Templates are firm-managed drafting bases shared
// across every matter, stored in WORKSPACE_ROOT/.templates and owned by ingest.
// The library directory ships alongside the list so the web app can scope its
// templates chat to it (the engine sessions run in TEMPLATES_DIR, not a matter).
app.get("/templates", async (c) => c.json({ dir: TEMPLATES_DIR, templates: await listTemplates() }))

app.post("/templates", async (c) => {
  const body = await c.req.parseBody()
  const file = body["file"] as File
  const buffer = Buffer.from(await file.arrayBuffer())
  const name = path.basename(file.name)
  writeFileSync(templatePath(name), buffer)
  const description = typeof body["description"] === "string" ? body["description"] : ""
  setTemplateDescription(name, description)
  const dx = await docxodus()
  const session = dx.openDocxSession(new Uint8Array(buffer), {})
  const placeholders = session.findPlaceholders().map((p) => ({ text: p.match.text, kind: p.kind, hint: p.hint }))
  session.close()
  return c.json({ name, description, placeholders })
})

app.patch("/templates", async (c) => {
  const { description } = await c.req.json<{ description: string }>()
  return c.json(setTemplateDescription(c.req.query("name") ?? "", description))
})

app.delete("/templates", (c) => {
  const name = c.req.query("name") ?? ""
  rmSync(templatePath(name), { force: true })
  removeTemplateDescription(name)
  return c.json({ ok: true })
})

// Serve a template's .docx bytes so the dochaus draft-document tool can fill it,
// mirroring the matter document content route.
app.get("/templates/content", async (c) => {
  const file = templatePath(c.req.query("name") ?? "")
  if (!existsSync(file)) return c.notFound()
  return new Response(Bun.file(file).stream(), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `inline; filename="${path.basename(file)}"`,
    },
  })
})

// Pending redline proposals for one document — the change list the viewer's
// review panel renders (each as old -> new, with author).
app.get("/matters/:id/redlines", (c) => {
  const dir = matterDir(c.req.param("id"))
  if (!existsSync(path.join(dir, ".dochaus", "legal.db"))) return c.json([])
  const docPath = path.join(dir, path.basename(c.req.query("name") ?? ""))
  return c.json(listPendingRedlines(openDb(dir), docPath))
})

// The redlined view: the clean .docx compared against itself with every pending
// proposal applied, so the viewer renders native tracked changes green/red. Falls
// back to the clean bytes when nothing is pending.
app.get("/matters/:id/documents/redlined", async (c) => {
  const dir = matterDir(c.req.param("id"))
  const file = path.join(dir, path.basename(c.req.query("name") ?? ""))
  if (!existsSync(file)) return c.notFound()
  const rows = existsSync(path.join(dir, ".dochaus", "legal.db"))
    ? listPendingRedlines(openDb(dir), file)
    : []
  const bytes = await buildRedlined(await Bun.file(file).bytes(), rows)
  return new Response(bytes, {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  })
})

// Accept a single redline: bake it into the canonical .docx (the new accepted
// state, no tracked changes), re-index the document so search reflects the new
// text, and mark it accepted. Re-resolves the anchor text against the live doc, so
// a clause an earlier accept already rewrote fails loudly instead of corrupting.
app.post("/matters/:id/redlines/:rid/accept", async (c) => {
  const dir = matterDir(c.req.param("id"))
  const row = getRedline(openDb(dir), Number(c.req.param("rid")))
  if (!row || row.status !== "pending") return c.json({ error: "Redline not found or already resolved" }, 404)
  const baked = await bake(await Bun.file(row.doc_path).bytes(), [row])
  await ingestDocument(dir, row.doc_name, Buffer.from(baked))
  setRedlineStatus(openDb(dir), row.id, "accepted")
  return c.json({ ok: true })
})

app.post("/matters/:id/redlines/:rid/reject", (c) => {
  const dir = matterDir(c.req.param("id"))
  const row = getRedline(openDb(dir), Number(c.req.param("rid")))
  if (!row || row.status !== "pending") return c.json({ error: "Redline not found or already resolved" }, 404)
  setRedlineStatus(openDb(dir), row.id, "rejected")
  return c.json({ ok: true })
})

// Accept every pending redline on a document in one pass: bake them in document
// order, re-index once, mark all accepted.
app.post("/matters/:id/redlines/accept-all", async (c) => {
  const dir = matterDir(c.req.param("id"))
  const file = path.join(dir, path.basename(c.req.query("name") ?? ""))
  if (!existsSync(file) || !existsSync(path.join(dir, ".dochaus", "legal.db"))) return c.json({ ok: true, accepted: 0 })
  const rows = listPendingRedlines(openDb(dir), file)
  if (rows.length) {
    await ingestDocument(dir, path.basename(file), Buffer.from(await bake(await Bun.file(file).bytes(), rows)))
    for (const row of rows) setRedlineStatus(openDb(dir), row.id, "accepted")
  }
  return c.json({ ok: true, accepted: rows.length })
})

app.post("/matters/:id/redlines/reject-all", (c) => {
  const dir = matterDir(c.req.param("id"))
  const file = path.join(dir, path.basename(c.req.query("name") ?? ""))
  if (!existsSync(path.join(dir, ".dochaus", "legal.db"))) return c.json({ ok: true, rejected: 0 })
  const rows = listPendingRedlines(openDb(dir), file)
  for (const row of rows) setRedlineStatus(openDb(dir), row.id, "rejected")
  return c.json({ ok: true, rejected: rows.length })
})

// Bind loopback by default like opencode (packages/opencode/src/cli/network.ts):
// the service is self-hosted alongside the engine and web app, not exposed
// directly. Front it with a reverse proxy to serve beyond localhost.
const port = Number(process.env.INGEST_PORT ?? 4500)
const hostname = process.env.INGEST_HOST ?? "127.0.0.1"
console.log(`doc.haus ingest service listening on http://${hostname}:${port}`)
export default { port, hostname, fetch: app.fetch }
