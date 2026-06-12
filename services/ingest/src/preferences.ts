import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { WORKSPACE_ROOT } from "./matter"

// Firm-wide drafting preferences set in the web settings. They steer every
// assistant, so they live on the engine as a standing instructions file:
// dochaus/opencode.json lists {env:WORKSPACE_ROOT}/.preferences/drafting.md in
// config.instructions, and the engine re-reads that file on every turn — so a
// save here applies from the next reply, no restart. The JSON beside it is the
// structured source the settings form round-trips; the markdown is rendered
// from it and never edited directly.
const PREFS_DIR = () => path.join(WORKSPACE_ROOT, ".preferences")
const JSON_FILE = () => path.join(PREFS_DIR(), "preferences.json")
const INSTRUCTIONS_FILE = () => path.join(PREFS_DIR(), "drafting.md")

export type DraftingPreferences = {
  attorney: string
  firm: string
  posture: "client-favorable" | "balanced" | "conservative"
  formality: "formal" | "plain"
  detail: "concise" | "detailed"
  dateFormat: "month-day-year" | "day-month-year" | "iso"
  numberStyle: "words-and-numerals" | "numerals"
  houseStyle: string
  // Enforced by the legal plugin's webfetch fence (dochaus/lib/research.ts),
  // not rendered into drafting.md: "official" limits web research to official
  // primary legal sources; "open" allows the whole web.
  webResearch: "official" | "open"
}

export const DEFAULT_DRAFTING: DraftingPreferences = {
  attorney: "",
  firm: "",
  posture: "balanced",
  formality: "formal",
  detail: "concise",
  dateFormat: "month-day-year",
  numberStyle: "words-and-numerals",
  houseStyle: "",
  webResearch: "official",
}

export function readDraftingPreferences(): DraftingPreferences {
  if (!existsSync(JSON_FILE())) return DEFAULT_DRAFTING
  return { ...DEFAULT_DRAFTING, ...(JSON.parse(readFileSync(JSON_FILE(), "utf8")) as Partial<DraftingPreferences>) }
}

export function writeDraftingPreferences(input: DraftingPreferences): DraftingPreferences {
  const prefs = { ...DEFAULT_DRAFTING, ...input }
  mkdirSync(PREFS_DIR(), { recursive: true })
  writeFileSync(JSON_FILE(), JSON.stringify(prefs, null, 2) + "\n")
  writeFileSync(INSTRUCTIONS_FILE(), renderInstructions(prefs))
  return prefs
}

const POSTURE: Record<DraftingPreferences["posture"], string> = {
  "client-favorable":
    "Favor the client's position: protect the client's interests and push obligations, risk, and discretion to the counterparty where reasonably defensible.",
  balanced: "Draft balanced, market-standard positions that a counterparty would recognize as fair.",
  conservative:
    "Draft conservatively: minimize the client's risk exposure and prefer well-tested market-standard language over novel or aggressive positions.",
}

const FORMALITY: Record<DraftingPreferences["formality"], string> = {
  formal: "Use formal legal drafting style throughout.",
  plain:
    "Prefer plain-language drafting: short sentences, minimal legalese, and defined terms only where they add real precision.",
}

const DETAIL: Record<DraftingPreferences["detail"], string> = {
  concise: "Keep explanations concise: lead with the conclusion, then a brief rationale.",
  detailed: "Explain your reasoning in detail, including the risks you considered and the alternatives you rejected.",
}

const DATES: Record<DraftingPreferences["dateFormat"], string> = {
  "month-day-year": 'Write dates in the form "June 11, 2026".',
  "day-month-year": 'Write dates in the form "11 June 2026".',
  iso: 'Write dates in ISO form, "2026-06-11".',
}

const NUMBERS: Record<DraftingPreferences["numberStyle"], string> = {
  "words-and-numerals": 'In operative contract text, write numbers as words followed by numerals: "thirty (30) days".',
  numerals: 'Write numbers as plain numerals: "30 days".',
}

function renderInstructions(prefs: DraftingPreferences) {
  const who = prefs.attorney
    ? [`Documents are prepared by ${prefs.attorney}${prefs.firm ? ` of ${prefs.firm}` : ""}.`]
    : prefs.firm
      ? [`Documents are prepared by ${prefs.firm}.`]
      : []
  const house = prefs.houseStyle.trim()
  return [
    "# Drafting preferences",
    "",
    "<drafting_preferences>",
    "The lawyer using doc.haus has set these firm-wide preferences. Apply them whenever you draft, edit, or propose changes to a document, and when you explain your work.",
    ...who,
    `- ${POSTURE[prefs.posture]}`,
    `- ${FORMALITY[prefs.formality]}`,
    `- ${DETAIL[prefs.detail]}`,
    `- ${DATES[prefs.dateFormat]}`,
    `- ${NUMBERS[prefs.numberStyle]}`,
    "</drafting_preferences>",
    ...(house ? ["", "<house_style>", house, "</house_style>"] : []),
    "",
  ].join("\n")
}
