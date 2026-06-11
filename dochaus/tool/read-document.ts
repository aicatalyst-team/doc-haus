import { tool } from "@opencode-ai/plugin"
import { readFileSync } from "node:fs"
import path from "node:path"

// doc.haus read-document tool. Returns the full plain text of an existing matter
// document, mammoth-extracted by the ingest service (the same text indexing uses).
// search-document returns only the relevant chunks; this returns the whole
// document, which the drafter needs to convert an existing document into a
// template by rewriting every client-specific detail as a placeholder. Read-only,
// so it carries no approval gate.

const ingestUrl = process.env.INGEST_URL ?? "http://127.0.0.1:4500"

export default tool({
  description:
    "Read the full plain text of an existing document in this matter. Use to load a whole document — e.g. before turning it into a reusable template, where you need the entire body, not just search-document's matching chunks.",
  args: {
    document: tool.schema.string().describe('The document file name in this matter, e.g. "Acme NDA.docx"'),
  },
  async execute(args, ctx) {
    const name = path.basename(args.document)
    const matter = JSON.parse(readFileSync(path.join(ctx.directory, "matter.json"), "utf8")) as { id: string }
    const res = await fetch(`${ingestUrl}/matters/${matter.id}/documents/text?name=${encodeURIComponent(name)}`)
    if (!res.ok) return `Could not read ${name} (${res.status}). Check the document name.`
    const { text } = (await res.json()) as { text: string }
    return {
      title: `Read ${name}`,
      output: text,
      metadata: { document: name },
    }
  },
})
