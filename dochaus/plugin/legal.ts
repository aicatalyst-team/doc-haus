import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, statSync } from "node:fs"
import { formatCitations, type DocumentCitation } from "../lib/citations"

// doc.haus legal plugin — citation verification (issue #6).
//
// After `search-document` returns, every citation's span is re-checked against
// the live source file: the document is re-extracted with the same extractors
// ingest uses (mammoth for DOCX, unpdf for PDF) and the cited span must
// reproduce the excerpt exactly. A mismatch means the retrieval index is stale
// — the file changed after it was indexed — so the citation is rejected before
// the model or the user ever sees it, and the model is told the document needs
// re-ingesting. A lawyer must never be handed a quote whose span no longer
// exists in the document.

const CACHE_LIMIT = 64
// Extraction is per-document, not per-citation: cache by path, invalidate on
// mtime so an accepted redline or re-upload is picked up immediately.
const textCache = new Map<string, { mtimeMs: number; text: string }>()

async function indexedText(docPath: string) {
  const mtimeMs = statSync(docPath).mtimeMs
  const hit = textCache.get(docPath)
  if (hit && hit.mtimeMs === mtimeMs) return hit.text
  const buffer = Buffer.from(await Bun.file(docPath).arrayBuffer())
  // Ingest computes offsets by accumulating `line + "\n"` over the extracted
  // text, which equals the raw extraction plus exactly one trailing newline —
  // mirror that here or the final chunk of every document fails verification.
  const text = (await extract(docPath, buffer)) + "\n"
  if (!textCache.has(docPath) && textCache.size >= CACHE_LIMIT) {
    const oldest = textCache.keys().next().value
    if (oldest !== undefined) textCache.delete(oldest)
  }
  textCache.set(docPath, { mtimeMs, text })
  return text
}

// Must stay in lockstep with extractDocumentText in services/ingest/src/ingest.ts:
// same extractors, same options, or offsets stop lining up.
async function extract(docPath: string, buffer: Buffer) {
  if (docPath.toLowerCase().endsWith(".pdf")) {
    const { extractText, getDocumentProxy } = await import("unpdf")
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(buffer)), { mergePages: true })
    return text
  }
  const { default: mammoth } = await import("mammoth")
  return (await mammoth.extractRawText({ buffer })).value
}

export const LegalPlugin: Plugin = async () => ({
  "tool.execute.after": async (input, output) => {
    if (input.tool !== "search-document") return
    const citations = output.metadata?.citations as DocumentCitation[] | undefined
    if (!citations?.length) return

    const verified: DocumentCitation[] = []
    const rejected: DocumentCitation[] = []
    for (const citation of citations) {
      const live =
        existsSync(citation.docPath) &&
        (await indexedText(citation.docPath)).slice(citation.charStart, citation.charEnd) === citation.excerpt
      if (live) verified.push({ ...citation, verified: true })
      else rejected.push(citation)
    }

    output.metadata.citations = verified
    if (!rejected.length) return

    const staleDocs = [...new Set(rejected.map((c) => c.documentName))].join(", ")
    output.title = `${verified.length} verified passage(s) (${rejected.length} rejected as stale)`
    output.output =
      (formatCitations(verified) || "No passages survived verification.") +
      `\n\n[citation-verification] ${rejected.length} citation(s) from ${staleDocs} were rejected: ` +
      `their cited spans no longer match the live document, so the index is stale. ` +
      `Do not quote or rely on the rejected passages. Tell the user that ${staleDocs} ` +
      `changed after indexing and must be re-uploaded (re-ingested) before its contents can be cited.`
  },
})
