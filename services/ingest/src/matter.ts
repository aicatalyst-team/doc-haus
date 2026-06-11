import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

// A matter is a directory under WORKSPACE_ROOT holding a matter.json plus the
// uploaded documents. This is the same directory the opencode server scopes a
// session to via the x-opencode-directory header.

export const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? path.join(process.cwd(), "workspace")

// reference is the firm's own client-matter number (e.g. "2026-0042"), shown in
// the UI. It is display metadata only — the directory id stays the auto slug+uuid.
// jurisdictions are pack codes (e.g. ["EW", "US-NY"]) the engine reads from
// matter.json to steer reasoning and citation style; a matter can span several
// (cross-border deal), so it is a list — see dochaus/jurisdiction/ (issue #18).
export type Matter = {
  id: string
  title: string
  reference?: string
  jurisdictions?: string[]
  dir: string
  created_at: number
}

function matterFile(dir: string) {
  return path.join(dir, "matter.json")
}

// A matter id is the auto-generated slug+uuid from createMatter, so it is always
// [a-z0-9-]. Reject anything else before it reaches a filesystem path: the id
// arrives straight from a URL param, and matterDir is the single chokepoint every
// route resolves through, so guarding here blocks path traversal (../, absolute
// paths) out of WORKSPACE_ROOT across the whole service.
export function matterDir(id: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`invalid matter id: ${id}`)
  return path.join(WORKSPACE_ROOT, id)
}

export function listMatters(): Matter[] {
  mkdirSync(WORKSPACE_ROOT, { recursive: true })
  return readdirSync(WORKSPACE_ROOT)
    .map((name) => path.join(WORKSPACE_ROOT, name))
    .filter((dir) => statSync(dir).isDirectory() && existsSync(matterFile(dir)))
    .map((dir) => JSON.parse(readFileSync(matterFile(dir), "utf8")) as Matter)
    .sort((a, b) => a.created_at - b.created_at)
}

export function createMatter(title: string, reference?: string, jurisdictions?: string[]): Matter {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const id = `${slug}-${crypto.randomUUID().slice(0, 6)}`
  const dir = matterDir(id)
  mkdirSync(dir, { recursive: true })
  const matter: Matter = { id, title, reference, jurisdictions, dir, created_at: Date.now() }
  writeFileSync(matterFile(dir), JSON.stringify(matter, null, 2))
  return matter
}

// Rename keeps the directory id stable (it backs every session and document
// path); only the display title/reference/jurisdictions in matter.json change.
export function renameMatter(id: string, title: string, reference?: string, jurisdictions?: string[]): Matter {
  const dir = matterDir(id)
  const matter = { ...getMatter(id), title, reference, jurisdictions }
  writeFileSync(matterFile(dir), JSON.stringify(matter, null, 2))
  return matter
}

export function deleteMatter(id: string) {
  rmSync(matterDir(id), { recursive: true, force: true })
}

export function getMatter(id: string): Matter {
  return JSON.parse(readFileSync(matterFile(matterDir(id)), "utf8")) as Matter
}

// The jurisdiction packs available to assign to a matter, read from the dochaus
// config layer (dochaus/jurisdiction/<code>/profile.json). The web app fetches
// this to offer the choices; the engine consumes the full pack (issue #18).
// Resolved relative to this module like the template seed, so it does not depend
// on the ingest process cwd.
const JURISDICTION_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "dochaus",
  "jurisdiction",
)

export function listJurisdictions() {
  if (!existsSync(JURISDICTION_DIR)) return []
  return readdirSync(JURISDICTION_DIR)
    .map((code) => path.join(JURISDICTION_DIR, code, "profile.json"))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, "utf8")) as { code: string; name: string; citationStyle: string })
    .sort((a, b) => a.name.localeCompare(b.name))
}
