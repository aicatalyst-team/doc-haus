import type { Plugin } from "@opencode-ai/plugin"
import { existsSync } from "node:fs"
import { findQuote, liveText } from "../lib/extract"
import { formatCitations, type DocumentCitation } from "../lib/citations"
import { loadJurisdiction, readMatterJurisdictions } from "../lib/jurisdiction"

// doc.haus legal plugin — citation verification (issue #6) and per-matter
// jurisdiction steering (issue #18).
//
// Jurisdiction steering: the plugin instance is scoped to the active matter's
// directory (the engine instantiates one per matter via x-opencode-directory),
// so it reads that matter's jurisdictions from matter.json and appends each
// matching pack's prompt fragment to the system prompt for every turn (a matter
// can span several, e.g. a cross-border deal). This is what makes a matter's
// reasoning, citation style, and authority hierarchy jurisdiction-aware without
// forking a per-jurisdiction agent — a pack is config-only (dochaus/jurisdiction/<code>/).
//
// After any tool returns citations (search-document's retrieval hits, the cite
// tool's anchored quotations), every citation's span is re-checked against the
// live source file: the document is re-extracted with the same extractors ingest
// uses, then each citation runs a three-step ladder:
//   1. exact   — the stored span still reproduces the excerpt verbatim → verified.
//   2. re-anchor — the excerpt no longer sits at that offset but still appears
//      elsewhere in the document (an edit shifted the text); repair the span to
//      the nearest occurrence and mark it re-anchored → verified.
//   3. reject  — the excerpt is nowhere in the live document; drop it.
// Re-anchored and rejected citations both mean the retrieval index is stale, so
// the model is told to have the document re-ingested. A lawyer must never be
// handed a quote whose text no longer exists in the document.

export const LegalPlugin: Plugin = async (input) => ({
  "experimental.chat.system.transform": async (_, output) => {
    const packs = (await Promise.all(readMatterJurisdictions(input.directory).map(loadJurisdiction))).filter(
      (p): p is NonNullable<typeof p> => Boolean(p),
    )
    for (const pack of packs) {
      output.system.push(
        `<jurisdiction code="${pack.code}" name="${pack.name}" citation="${pack.citationStyle}">\n` +
          pack.prompt.trim() +
          `\n</jurisdiction>`,
      )
    }
    // Safety stopgap (asset review 2026-06-11): the case-law tool searches U.S.
    // opinions only. Each pack's prompt.md should carry this warning itself (EW
    // does), but for any non-US matter it must hold even when a pack's prompt is
    // missing or omits it — so inject it unconditionally here.
    if (packs.some((pack) => pack.code !== "US" && !pack.code.startsWith("US-"))) {
      output.system.push(
        `<case-law-scope>\n` +
          `The \`case-law\` tool searches U.S. opinions only. This matter involves a non-U.S. ` +
          `jurisdiction: treat anything the tool returns as comparative and non-binding there, and ` +
          `never present a U.S. decision as authority for a non-U.S. jurisdiction. Questions turning ` +
          `on that jurisdiction's statutes or case law cannot be answered from this tool; when the ` +
          `binding position turns on authority you have not retrieved, say so plainly rather than ` +
          `reaching for U.S. material.\n` +
          `</case-law-scope>`,
      )
    }
  },
  "tool.execute.after": async (input, output) => {
    const citations = output.metadata?.citations as DocumentCitation[] | undefined
    if (!citations?.length) return

    const verified: DocumentCitation[] = []
    const rejected: DocumentCitation[] = []
    for (const citation of citations) {
      const resolved = await verifyCitation(citation)
      if (resolved) verified.push(resolved)
      else rejected.push(citation)
    }

    output.metadata.citations = verified

    const reanchored = verified.filter((c) => c.reanchored)
    if (!rejected.length && !reanchored.length) return

    if (!rejected.length) {
      const changedDocs = [...new Set(reanchored.map((c) => c.documentName))].join(", ")
      output.title = `${verified.length} verified passage(s) (${reanchored.length} re-anchored)`
      output.output =
        formatCitations(verified) +
        `\n\n[citation-verification] ${reanchored.length} citation(s) were re-anchored because ${changedDocs} ` +
        `changed after indexing; the quotes were re-verified against the live document. ` +
        `Recommend re-uploading (re-ingesting) ${changedDocs} so search stays accurate.`
      return
    }

    const staleDocs = [...new Set(rejected.map((c) => c.documentName))].join(", ")
    output.title = `${verified.length} verified passage(s) (${rejected.length} rejected)`
    output.output =
      (formatCitations(verified) || "No passages survived verification.") +
      `\n\n[citation-verification] ` +
      (input.tool === "cite"
        ? `The quoted text could not be verified against the live document — do not present it to the user. `
        : `${rejected.length} quoted passage(s) from ${staleDocs} do not appear anywhere in the live document: ` +
          `either the passage was removed or the quotation is invalid. ` +
          `Do not quote or rely on the rejected passages. `) +
      `If ${staleDocs} changed after indexing, it must be re-uploaded (re-ingested) before its contents can be cited.`
  },
})

// Run the exact → re-anchor → reject ladder for one citation. Returns the
// verified (possibly re-anchored) citation, or undefined to reject it.
async function verifyCitation(citation: DocumentCitation) {
  if (!existsSync(citation.docPath)) return undefined
  const text = await liveText(citation.docPath)
  if (text.slice(citation.charStart, citation.charEnd) === citation.excerpt) return { ...citation, verified: true }

  // The span no longer matches — the document was edited after indexing. Search
  // for the excerpt; document edits shift offsets, so the occurrence nearest the
  // original charStart is almost certainly the same passage.
  const match = findQuote(text, citation.excerpt, citation.charStart)
  if (!match) return undefined
  return {
    ...citation,
    charStart: match.start,
    charEnd: match.end,
    excerpt: match.excerpt,
    verified: true,
    reanchored: true,
  }
}
