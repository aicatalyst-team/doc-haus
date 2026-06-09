import { tool } from "@opencode-ai/plugin"
import { existsSync } from "node:fs"
import path from "node:path"
import { docxodus } from "../lib/docxodus"
import { recordRedline } from "../lib/redlines"

// doc.haus redline tool. Proposes rewriting a whole clause — the paragraph a
// search-document citation points at — as a tracked change a reviewer accepts or
// rejects in the doc.haus app.
//
// This is the citation-driven, clause-level counterpart to the surgical
// find/replace tools (word-integration, tracked-changes): `clause` locates the
// paragraph and the whole paragraph is rewritten to `replacement`. We match on
// the block's flat text, whitespace-tolerant, because citation excerpts come
// from a different text extraction (mammoth) than Docxodus' own projection and
// their spacing/char offsets don't align — so we only ever LOCATE the block, we
// never offset-index into it.
//
// The proposal is recorded against the matter's index; the canonical .docx stays
// clean (the accepted state) until a reviewer accepts, when ingest bakes the edit
// in. So here we only locate the clause and capture its current text — we never
// modify the file.

export default tool({
  description:
    "Propose rewriting a whole clause as a tracked change, using a passage retrieved from search-document. Locates the paragraph containing `clause` and proposes replacing its entire text with `replacement`, attributed to an author. The change is recorded as a pending redline the user reviews and accepts or rejects in the doc.haus app — the document is not modified until they accept. Use this to redline a clause you found as a citation; use tracked-changes for a surgical word/phrase swap.",
  args: {
    document: tool.schema.string().describe("Document file name within the matter (the docPath from a citation)"),
    clause: tool.schema
      .string()
      .describe("Text from the clause to rewrite — the citation excerpt, or a sentence within it. Used to locate the paragraph."),
    replacement: tool.schema
      .string()
      .describe("The new clause text. Replaces the whole located paragraph; markdown is supported."),
    author: tool.schema.string().optional().describe("Name to attribute the tracked change to (default: doc.haus)"),
  },
  async execute(args, ctx) {
    const file = path.isAbsolute(args.document) ? args.document : path.join(ctx.directory, args.document)
    if (!existsSync(file)) return `Document not found in this matter: ${args.document}`

    const dx = await docxodus()
    const session = dx.openDocxSession(await Bun.file(file).bytes(), {})

    const target = session.findByText(args.clause, { ignoreWhitespace: true })
    if (!target) {
      session.close()
      return `Clause not found in ${path.basename(file)}: ${JSON.stringify(args.clause)}`
    }
    const oldText = session.projectAnchor(target.id).markdown.trim()
    session.close()

    const author = args.author ?? "doc.haus"
    const id = recordRedline(ctx.directory, {
      docPath: file,
      docName: path.basename(file),
      scope: "clause",
      findText: args.clause,
      oldText,
      newText: args.replacement,
      author,
      anchorId: target.id,
    })

    return {
      title: `Proposed redline in ${path.basename(file)}`,
      output: `Proposed rewriting the clause matching ${JSON.stringify(args.clause)} in ${path.basename(file)}, attributed to ${author}. Recorded as pending redline #${id} — the user reviews and accepts or rejects it in the doc.haus app.`,
      metadata: { document: file, clause: args.clause, oldText, replacement: args.replacement, anchor: target.id, author, redline: id },
    }
  },
})
