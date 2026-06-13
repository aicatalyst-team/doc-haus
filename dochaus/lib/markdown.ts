import type { DocxSession } from "docxodus"

// Docxodus's insertParagraph splits markdown into blocks on blank lines only,
// but in markdown an ATX heading line is its own block even when the body
// starts on the very next line. Without this, "## 1. Term\nThe term is..."
// collapses into ONE heading-styled paragraph carrying the whole clause body —
// which is how the corrupt employment-agreement template happened. Normalize
// before every insert so a heading line always lands as its own block.
export function splitHeadingBlocks(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => (/^ {0,3}#{1,6} /.test(line) ? `\n${line.trim()}\n` : line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// Templates number their clause headings in the heading text itself ("9.
// Non-Solicitation"), so deleting an optional clause leaves a hole in the
// sequence ("8." followed by "10."). Renumber every such heading to its
// position in document order. Body cross-references by section number are not
// rewritten.
export function renumberHeadings(session: DocxSession) {
  session
    .findByKind("h")
    .filter((h) => /^\d+\. /.test(h.textPreview))
    .forEach((h, i) => {
      const current = h.textPreview.match(/^(\d+)\./)![1]
      if (current !== `${i + 1}`) session.replaceTextRange(h.id, `${current}.`, `${i + 1}.`, { maxReplacements: 1 })
    })
}
