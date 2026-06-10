import { tool } from "@opencode-ai/plugin"
import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import path from "node:path"
import { formatCitations } from "../lib/citations"

// doc.haus retrieval tool. Reads the per-matter legal.db that
// `services/ingest` populates, embeds the query with the same local MiniLM model
// used at ingest time, and returns the closest document chunks as citations.
//
// The database lives inside the matter directory (`<matter>/.dochaus/legal.db`)
// so retrieval is naturally scoped to the active matter and never crosses into
// another matter's privileged material. This tool is read-only; all writes
// happen in the ingest service.

const MODEL = "Xenova/all-MiniLM-L6-v2"
const DIM = 384

let extractor: any
async function embed(text: string) {
  if (!extractor) {
    const { pipeline } = await import("@xenova/transformers")
    extractor = await pipeline("feature-extraction", MODEL)
  }
  const output = await extractor(text, { pooling: "mean", normalize: true })
  return output.data as Float32Array
}

function dot(a: Float32Array, b: Float32Array) {
  let sum = 0
  for (let i = 0; i < DIM; i++) sum += a[i] * b[i]
  return sum
}

// Per-session memory of the most recent result-sets. A model in a search loop
// keeps rephrasing the query but gets back the *same* passages every time (e.g.
// hunting a section that does not exist). When an incoming result-set matches
// one already returned in the last few calls, we short-circuit and steer the
// model to answer from what it has rather than searching again. Upstream's V2
// runner does not yet bound repeated identical tool calls (see runner/llm.ts),
// so the bound lives here at the tool boundary.
const RECENT_LIMIT = 5
// Cap how many sessions we keep loop-detection state for, so a long-lived
// server process does not accumulate one entry per session forever.
const SESSION_LIMIT = 256
const recentBySession = new Map<string, string[]>()

export default tool({
  description:
    "Search the current matter's documents for passages relevant to a query and return them as citations. Use this before answering any question about a document.",
  args: {
    query: tool.schema.string().describe("What to search for, in natural language"),
    k: tool.schema.number().int().min(1).max(20).optional().describe("Number of passages to return (default 5)"),
    document: tool.schema
      .string()
      .optional()
      .describe("Restrict the search to a single document by its exact name. Omit to search the whole matter."),
  },
  async execute(args, ctx) {
    const dbPath = path.join(ctx.directory, ".dochaus", "legal.db")
    if (!existsSync(dbPath)) {
      return "No documents have been indexed for this matter yet."
    }

    const queryVec = await embed(args.query)
    const k = args.k ?? 5

    const db = new Database(dbPath, { readonly: true })
    const sql =
      "SELECT doc_name, doc_path, section, text, char_start, char_end, embedding FROM chunks" +
      (args.document ? " WHERE doc_name = ?" : "")
    const rows = (args.document ? db.query(sql).all(args.document) : db.query(sql).all()) as Array<{
      doc_name: string
      doc_path: string
      section: string
      text: string
      char_start: number
      char_end: number
      embedding: Uint8Array
    }>
    db.close()

    const ranked = rows
      .map((row) => {
        const buf = row.embedding
        const vec = new Float32Array(buf.buffer, buf.byteOffset, DIM)
        return { row, score: dot(queryVec, vec) }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, k)

    const signature = ranked.map(({ row }) => `${row.doc_name}§${row.section}`).join("|")
    const recent = recentBySession.get(ctx.sessionID) ?? []
    if (recent.includes(signature)) {
      console.warn(
        `[search-document] repeated result-set in session ${ctx.sessionID} for query "${args.query}" — short-circuiting to break a search loop`,
      )
      return "These passages were already returned by an earlier search this turn — the same results matched again, so searching further will not surface anything new. Answer from the passages you have already retrieved; if they do not address the question, say the documents do not cover it. Do not repeat this search."
    }
    if (!recentBySession.has(ctx.sessionID) && recentBySession.size >= SESSION_LIMIT) {
      const oldest = recentBySession.keys().next().value
      if (oldest !== undefined) recentBySession.delete(oldest)
    }
    recentBySession.set(ctx.sessionID, [signature, ...recent].slice(0, RECENT_LIMIT))

    const citations = ranked.map(({ row, score }) => ({
      documentName: row.doc_name,
      docPath: row.doc_path,
      section: row.section,
      excerpt: row.text,
      charStart: row.char_start,
      charEnd: row.char_end,
      score,
    }))

    return {
      title: `${citations.length} passage(s) for "${args.query}"`,
      output: formatCitations(citations) || "No relevant passages found.",
      metadata: { citations },
    }
  },
})
