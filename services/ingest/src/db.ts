import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import path from "node:path"

// Per-matter retrieval index. Lives inside the matter directory so it is scoped
// to that matter and rebuildable from the source .docx files at any time.

export function openDb(matterDir: string): Database {
  const dir = path.join(matterDir, ".dochaus")
  mkdirSync(dir, { recursive: true })
  const db = new Database(path.join(dir, "legal.db"))
  db.run("PRAGMA journal_mode = WAL")
  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      doc_path TEXT NOT NULL,
      doc_name TEXT NOT NULL,
      section TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      char_start INTEGER NOT NULL,
      char_end INTEGER NOT NULL,
      embedding BLOB NOT NULL
    )
  `)
  // Pending redline proposals. The canonical .docx stays clean (the accepted
  // state); each redline a tool proposes is a row here until a reviewer accepts
  // it (baked into the doc) or rejects it. scope drives how the edit is replayed:
  // 'phrase' is a surgical find/replace, 'clause' rewrites a located paragraph.
  // The redline tools (dochaus/tool/{redline,tracked-changes}.ts) create the same
  // table independently, so keep this DDL in sync with them.
  db.run(`
    CREATE TABLE IF NOT EXISTS redlines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_path TEXT NOT NULL,
      doc_name TEXT NOT NULL,
      scope TEXT NOT NULL,
      find_text TEXT NOT NULL,
      old_text TEXT NOT NULL,
      new_text TEXT NOT NULL,
      author TEXT NOT NULL,
      anchor_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL
    )
  `)
  return db
}

export type RedlineRow = {
  id: number
  doc_path: string
  doc_name: string
  scope: "phrase" | "clause"
  find_text: string
  old_text: string
  new_text: string
  author: string
  anchor_id: string | null
  // 'superseded': a later proposal on the same paragraph replaced this one before
  // review (set by the redline tools), so it never reaches the pending queue.
  status: "pending" | "accepted" | "rejected" | "superseded"
  created_at: number
}

// Pending redlines for one document, oldest first — the order they are replayed
// when building the redlined view and when accepting in bulk.
export function listPendingRedlines(db: Database, docPath: string): RedlineRow[] {
  return db
    .query("SELECT * FROM redlines WHERE doc_path = ? AND status = 'pending' ORDER BY created_at, id")
    .all(docPath) as RedlineRow[]
}

export function getRedline(db: Database, id: number): RedlineRow | null {
  return (db.query("SELECT * FROM redlines WHERE id = ?").get(id) as RedlineRow) ?? null
}

export function setRedlineStatus(db: Database, id: number, status: "accepted" | "rejected") {
  db.run("UPDATE redlines SET status = ? WHERE id = ?", [status, id])
}

// Per-document pending counts, keyed by absolute doc_path, for the docs-rail badge.
export function pendingRedlineCounts(db: Database): Record<string, number> {
  const rows = db
    .query("SELECT doc_path, COUNT(*) AS n FROM redlines WHERE status = 'pending' GROUP BY doc_path")
    .all() as { doc_path: string; n: number }[]
  return Object.fromEntries(rows.map((r) => [r.doc_path, r.n]))
}

export function listDocuments(db: Database) {
  return db.query("SELECT id, doc_path, name, created_at FROM documents ORDER BY created_at").all()
}

// Drop a document and its chunks from the index. Pairs with removing the source
// .docx so the matter holds no orphaned embeddings.
export function deleteDocument(db: Database, docPath: string) {
  db.run("DELETE FROM chunks WHERE doc_path = ?", [docPath])
  db.run("DELETE FROM documents WHERE doc_path = ?", [docPath])
}

// Re-ingesting a document replaces its rows so the index never holds stale chunks.
export function upsertDocument(db: Database, docPath: string, name: string, createdAt: number): number {
  db.run("DELETE FROM chunks WHERE doc_path = ?", [docPath])
  db.run("DELETE FROM documents WHERE doc_path = ?", [docPath])
  const result = db.run("INSERT INTO documents (doc_path, name, created_at) VALUES (?, ?, ?)", [docPath, name, createdAt])
  return Number(result.lastInsertRowid)
}

export function insertChunk(
  db: Database,
  chunk: {
    documentId: number
    docPath: string
    docName: string
    section: string
    chunkIndex: number
    text: string
    charStart: number
    charEnd: number
    embedding: Float32Array
  },
) {
  db.run(
    "INSERT INTO chunks (document_id, doc_path, doc_name, section, chunk_index, text, char_start, char_end, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      chunk.documentId,
      chunk.docPath,
      chunk.docName,
      chunk.section,
      chunk.chunkIndex,
      chunk.text,
      chunk.charStart,
      chunk.charEnd,
      Buffer.from(chunk.embedding.buffer, chunk.embedding.byteOffset, chunk.embedding.byteLength),
    ],
  )
}
