import { writeFileSync } from "node:fs"
import path from "node:path"
import mammoth from "mammoth"
import { openDb, upsertDocument, insertChunk } from "./db"
import { embed } from "./embed"
import { pdfToText } from "./pdf"

// ~500 tokens at roughly 4 chars/token.
const CHUNK_CHARS = 2000

// A clause line like "7.2 Termination" or "12. Governing Law".
const CLAUSE_RE = /^\s*(\d+(?:\.\d+)*)[.)]?\s+(.+)$/
// A heading line: short, mostly uppercase, no trailing sentence punctuation.
const HEADING_RE = /^[A-Z0-9][A-Z0-9 ,'\-&/]{2,79}$/

type Section = { label: string; text: string; charStart: number; charEnd: number }

export function sectionize(text: string): Section[] {
  const sections: Section[] = []
  let current: Section = { label: "Preamble", text: "", charStart: 0, charEnd: 0 }
  let offset = 0

  for (const line of text.split("\n")) {
    // markitdown emits Markdown headings; strip the hashes so "## 7.2 Termination"
    // sections the same as a plain "7.2 Termination" line.
    const trimmed = line.trim().replace(/^#{1,6}\s+/, "")
    const isMdHeading = trimmed !== line.trim()
    const clause = trimmed.match(CLAUSE_RE)
    const isHeading = clause || isMdHeading || (trimmed.length > 0 && HEADING_RE.test(trimmed))
    if (isHeading && trimmed.length > 0) {
      if (current.text.trim()) {
        current.charEnd = offset
        sections.push(current)
      }
      const label = clause?.[1] ?? trimmed
      current = { label, text: line + "\n", charStart: offset, charEnd: 0 }
    } else {
      current.text += line + "\n"
    }
    offset += line.length + 1
  }
  if (current.text.trim()) {
    current.charEnd = offset
    sections.push(current)
  }
  return sections
}

function chunkSection(section: Section) {
  const chunks: { text: string; charStart: number; charEnd: number }[] = []
  for (let i = 0; i < section.text.length; i += CHUNK_CHARS) {
    const slice = section.text.slice(i, i + CHUNK_CHARS)
    if (!slice.trim()) continue
    chunks.push({ text: slice, charStart: section.charStart + i, charEnd: section.charStart + i + slice.length })
  }
  return chunks
}

export async function ingestDocument(matterDir: string, fileName: string, buffer: Buffer) {
  const docPath = path.join(matterDir, fileName)
  writeFileSync(docPath, buffer)

  const text = await extractDocumentText(fileName, buffer)
  const sections = sectionize(text)

  const db = openDb(matterDir)
  const documentId = upsertDocument(db, docPath, fileName, Date.now())

  let chunkIndex = 0
  for (const section of sections) {
    for (const chunk of chunkSection(section)) {
      const embedding = await embed(chunk.text)
      insertChunk(db, {
        documentId,
        docPath,
        docName: fileName,
        section: section.label,
        chunkIndex: chunkIndex++,
        text: chunk.text,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        embedding,
      })
    }
  }
  db.close()

  return { name: fileName, docPath, sections: sections.length, chunks: chunkIndex }
}

// Pull plain text from a source document for indexing. DOCX goes through mammoth;
// PDF through markitdown/unpdf with an OCR fallback for flat scans (see pdf.ts).
// Both feed the same sectionize/chunk/embed path, so the rest of ingestion is
// format-agnostic.
export async function extractDocumentText(fileName: string, buffer: Buffer) {
  if (fileName.toLowerCase().endsWith(".pdf")) return pdfToText(buffer)
  return (await mammoth.extractRawText({ buffer })).value
}
