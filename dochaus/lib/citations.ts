// Shared citation shape and rendering, used by the search-document tool (which
// produces citations) and the legal plugin (which re-renders the surviving set
// after span verification). One formatter keeps the two outputs identical.

export type DocumentCitation = {
  documentName: string
  docPath: string
  section: string
  excerpt: string
  charStart: number
  charEnd: number
  score: number
  verified?: boolean
}

export function formatCitations(citations: DocumentCitation[]) {
  return citations
    .map((c, i) => `${i + 1}. [${c.documentName} § ${c.section}] (score ${c.score.toFixed(3)})\n${c.excerpt}`)
    .join("\n\n")
}
