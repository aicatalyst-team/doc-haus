import { tool } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { docxodus } from "../lib/docxodus"

// doc.haus draft-document tool. Creates a NEW Word (.docx) document in the
// current matter — either by filling a template from dochaus/templates, or from
// scratch by composing markdown onto the styled blank seed (_base.docx). Docxodus
// can edit a .docx but not create one from nothing, so every draft starts from
// seed bytes that carry the house style set (Title, Heading 1-3), which is what
// makes markdown headings land as real Word styles.
//
// The finished bytes are handed to the ingest service's upload route, which is
// the single writer for matter documents: it writes the .docx into the matter
// directory AND indexes it (sectionize, chunk, embed), so search-document and the
// web viewer see the new draft immediately.

const templatesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "templates")
const ingestUrl = process.env.INGEST_URL ?? "http://127.0.0.1:4500"

export default tool({
  description:
    'Create a new Word (.docx) document in this matter. Two modes: pass "template" (a name from list-templates) plus "fills" to draft from a template, or pass "content" (full document body as markdown — headings, paragraphs, lists, one blank line between blocks) to draft from scratch. Returns any placeholders still unfilled so they can be completed with the editing tools.',
  args: {
    name: tool.schema
      .string()
      .describe('File name for the new document, e.g. "Acme NDA.docx" (".docx" is appended if missing)'),
    template: tool.schema.string().optional().describe("Template file name from list-templates, e.g. \"nda.docx\""),
    fills: tool.schema
      .array(
        tool.schema.object({
          placeholder: tool.schema.string().describe('Exact placeholder text from list-templates, e.g. "[insert state]"'),
          value: tool.schema.string().describe("Replacement text (replaces the whole bracketed placeholder)"),
        }),
      )
      .optional()
      .describe("For template mode: the placeholder values to fill in"),
    content: tool.schema
      .string()
      .optional()
      .describe("For from-scratch mode: the complete document body as markdown"),
  },
  async execute(args, ctx) {
    const name = path.basename(args.name.endsWith(".docx") ? args.name : `${args.name}.docx`)
    const target = path.join(ctx.directory, name)
    if (existsSync(target)) return `A document named ${name} already exists in this matter. Pick a different name.`
    if (!args.template && !args.content) return 'Pass either "template" (with "fills") or "content".'

    // Template mode pulls the base bytes from the global library over HTTP (ingest
    // is the single writer over WORKSPACE_ROOT); from-scratch mode uses the repo's
    // styled blank seed (_base.docx), which is never user-visible.
    const templateRes = args.template
      ? await fetch(`${ingestUrl}/templates/content?name=${encodeURIComponent(args.template)}`)
      : undefined
    if (templateRes && !templateRes.ok) return `Unknown template: ${args.template}. Call list-templates for the available ones.`
    const sourceBytes = templateRes
      ? new Uint8Array(await templateRes.arrayBuffer())
      : await Bun.file(path.join(templatesDir, "_base.docx")).bytes()

    // Creating a document in the matter is gated on the matter owner's approval,
    // like every other tool that changes matter files. Asked before any Docxodus
    // work so a rejection costs nothing.
    await ctx.ask({
      permission: "draft-document",
      patterns: [target],
      metadata: { document: name, template: args.template, mode: args.template ? "template" : "scratch" },
    })

    const dx = await docxodus()
    const session = dx.openDocxSession(sourceBytes, {})

    if (args.content) {
      // The seed's single empty paragraph is the insertion anchor; the whole
      // markdown body goes in as one multi-block insert, then the seed is dropped.
      const seed = Object.keys(session.project().anchorIndex).find((id) => id.startsWith("p:"))!
      const inserted = session.insertParagraph(seed, "after", args.content)
      if (!inserted.success) {
        session.close()
        return `Draft failed: ${inserted.error?.message ?? JSON.stringify(inserted.error)}`
      }
      session.deleteBlock(seed)
    }

    if (args.fills?.length) {
      const fills = Object.fromEntries(args.fills.map((f) => [f.placeholder, f.value]))
      session.fillPlaceholders((p) => fills[p.match.text] ?? null)
    }

    const remaining = session.findPlaceholders().map((p) => p.match.text)
    const bytes = session.save()
    session.close()

    // Upload through ingest rather than writing the file directly: its upload
    // route both writes the canonical .docx and indexes it for search.
    const matter = JSON.parse(readFileSync(path.join(ctx.directory, "matter.json"), "utf8")) as { id: string }
    const form = new FormData()
    form.append("file", new File([bytes], name))
    const res = await fetch(`${ingestUrl}/matters/${matter.id}/documents`, { method: "POST", body: form })
    if (!res.ok) return `Draft composed but ingest upload failed (${res.status}): ${await res.text()}`

    return {
      title: `Drafted ${name}`,
      output: [
        `Created ${name} in this matter${args.template ? ` from template ${args.template}` : " from scratch"}.`,
        remaining.length
          ? `Placeholders still unfilled: ${remaining.join(", ")}. Fill them with the editing tools or leave them for the lawyer.`
          : "No placeholders remain.",
      ].join(" "),
      metadata: { document: target, template: args.template, remainingPlaceholders: remaining },
    }
  },
})
