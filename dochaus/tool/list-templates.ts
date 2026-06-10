import { tool } from "@opencode-ai/plugin"
import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { docxodus } from "../lib/docxodus"

// doc.haus list-templates tool. Enumerates the drafting templates that ship in
// dochaus/templates and, for each, the placeholders Docxodus finds in it — so the
// model knows exactly which fills to gather before calling draft-document.
// `_base.docx` is the blank from-scratch seed, not a template, and is hidden.

const templatesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "templates")

export default tool({
  description:
    "List the document templates available for drafting, with the placeholders each one needs filled. Use before draft-document to pick a template and gather its fills.",
  args: {},
  async execute() {
    const names = readdirSync(templatesDir).filter((n) => n.endsWith(".docx") && !n.startsWith("_"))
    const dx = await docxodus()
    const templates = []
    for (const name of names) {
      const session = dx.openDocxSession(await Bun.file(path.join(templatesDir, name)).bytes(), {})
      templates.push({
        template: name,
        placeholders: session.findPlaceholders().map((p) => ({ text: p.match.text, kind: p.kind, hint: p.hint })),
      })
      session.close()
    }
    return {
      title: `${templates.length} template(s)`,
      output: JSON.stringify(templates, null, 2),
      metadata: { templates: names },
    }
  },
})
