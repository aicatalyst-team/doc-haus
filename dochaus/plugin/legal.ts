import type { Plugin } from "@opencode-ai/plugin"
import { existsSync } from "node:fs"
import { findQuote, liveText } from "../lib/extract"
import { formatCitations, type DocumentCitation } from "../lib/citations"

// doc.haus legal plugin — citation verification (issue #6).
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

export const LegalPlugin: Plugin = async () => ({
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
