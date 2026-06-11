// Shared citation shape and rendering, used by the tools that produce citations
// (search-document's vector hits, cite's anchored quotations) and the legal
// plugin (which re-renders the surviving set after span verification). One
// formatter keeps every output identical.

export type DocumentCitation = {
  documentName: string
  docPath: string
  section: string
  excerpt: string
  charStart: number
  charEnd: number
  // Vector hits from search-document carry a similarity score; quotations the
  // cite tool anchored do not, so score is optional.
  score?: number
  reason?: string
  confidence?: number
  context?: string
  verified?: boolean
  reanchored?: boolean
}

export function formatCitations(citations: DocumentCitation[]) {
  return citations
    .map((c, i) => {
      const score = c.score === undefined ? "" : ` (score ${c.score.toFixed(3)})`
      const reason =
        c.reason === undefined
          ? ""
          : `\n   reason: ${c.reason}${c.confidence === undefined ? "" : ` (confidence ${c.confidence}/5)`}`
      return `${i + 1}. [${c.documentName} § ${c.section}]${score}\n${c.excerpt}${reason}`
    })
    .join("\n\n")
}
