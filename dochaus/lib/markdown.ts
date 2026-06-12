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
