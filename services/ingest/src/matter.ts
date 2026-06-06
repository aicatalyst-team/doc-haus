import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs"
import path from "node:path"

// A matter is a directory under WORKSPACE_ROOT holding a matter.json plus the
// uploaded documents. This is the same directory the opencode server scopes a
// session to via the x-opencode-directory header.

export const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? path.join(process.cwd(), "workspace")

export type Matter = { id: string; title: string; dir: string; created_at: number }

function matterFile(dir: string) {
  return path.join(dir, "matter.json")
}

export function matterDir(id: string) {
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

export function createMatter(title: string): Matter {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const id = `${slug}-${crypto.randomUUID().slice(0, 6)}`
  const dir = matterDir(id)
  mkdirSync(dir, { recursive: true })
  const matter: Matter = { id, title, dir, created_at: Date.now() }
  writeFileSync(matterFile(dir), JSON.stringify(matter, null, 2))
  return matter
}

export function getMatter(id: string): Matter {
  return JSON.parse(readFileSync(matterFile(matterDir(id)), "utf8")) as Matter
}
