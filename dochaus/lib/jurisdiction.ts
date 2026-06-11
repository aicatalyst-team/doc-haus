import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

// A jurisdiction pack is a config-only bundle under dochaus/jurisdiction/<code>/:
//   profile.json — machine fields (code, name, citationStyle, preferredModel)
//   prompt.md    — the system-prompt fragment injected for matters in this
//                  jurisdiction (citation conventions, statutory framing, which
//                  authority is binding versus persuasive).
// Packs are swappable: a contributor adds a jurisdiction by dropping a new
// directory here, with no code change (issue #18). The loader resolves packs
// relative to this file so it works regardless of the engine's process cwd.

export type JurisdictionProfile = {
  code: string
  name: string
  citationStyle: string
  // The model a matter in this jurisdiction should run on once sovereign routing
  // (issues #11/#15) lands. Declarative today: it is recorded but not yet
  // enforced — there is only one (global) inference region, so nothing routes on
  // it. Kept here so the routing layer has the per-jurisdiction preference ready.
  preferredModel?: string | null
}

export type JurisdictionPack = JurisdictionProfile & { prompt: string }

const ROOT = path.join(import.meta.dir, "..", "jurisdiction")

// A pack code becomes a directory name joined to a filesystem path. It arrives
// from a matter's matter.json, so reject anything that could climb out of the
// jurisdiction directory before it reaches the path.
function packDir(code: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(code)) return undefined
  return path.join(ROOT, code)
}

export async function loadJurisdiction(code: string): Promise<JurisdictionPack | undefined> {
  const dir = packDir(code)
  if (!dir || !existsSync(path.join(dir, "profile.json"))) return undefined
  const profile = (await Bun.file(path.join(dir, "profile.json")).json()) as JurisdictionProfile
  const promptPath = path.join(dir, "prompt.md")
  return { ...profile, prompt: existsSync(promptPath) ? await Bun.file(promptPath).text() : "" }
}

// The jurisdiction code a matter carries, read from its matter.json. The ingest
// service owns that file; the engine only reads it to steer reasoning.
export function readMatterJurisdiction(directory: string) {
  const file = path.join(directory, "matter.json")
  if (!existsSync(file)) return undefined
  return (JSON.parse(readFileSync(file, "utf8")) as { jurisdiction?: string }).jurisdiction || undefined
}
