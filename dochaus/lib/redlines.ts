import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import path from "node:path"

// Record redline proposals into the matter's index DB. The redline tools propose
// changes here instead of writing tracked changes into the .docx; the ingest
// service reads these rows to render the redlined view and to accept (bake) or
// reject them. The canonical .docx stays clean until a reviewer accepts.
//
// Ingest owns this database and creates the same `redlines` table in its openDb;
// keep this DDL in sync with services/ingest/src/db.ts. We create-if-not-exists
// here too so a tool can propose before the document is ever (re-)ingested.

export function recordRedline(
  matterDir: string,
  row: {
    docPath: string
    docName: string
    scope: "phrase" | "clause"
    findText: string
    oldText: string
    newText: string
    author: string
    anchorId: string
  },
) {
  const dir = path.join(matterDir, ".dochaus")
  mkdirSync(dir, { recursive: true })
  const db = new Database(path.join(dir, "legal.db"))
  db.run("PRAGMA journal_mode = WAL")
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
  const result = db.run(
    "INSERT INTO redlines (doc_path, doc_name, scope, find_text, old_text, new_text, author, anchor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [row.docPath, row.docName, row.scope, row.findText, row.oldText, row.newText, row.author, row.anchorId, Date.now()],
  )
  db.close()
  return Number(result.lastInsertRowid)
}
