import { writeFileSync } from "node:fs"
import path from "node:path"
import mammoth from "mammoth"
import { openDb, upsertDocument, insertChunk } from "./db"
import { embed } from "./embed"

// ~500 tokens at roughly 4 chars/token.
const CHUNK_CHARS = 2000

// A clause line like "7.2 Termination" or "12. Governing Law".
const CLAUSE_RE = /^\s*(\d+(?:\.\d+)*)[.)]?\s+(.+)$/
// A heading line: short, mostly uppercase, no trailing sentence punctuation.
const HEADING_RE = /^[A-Z0-9][A-Z0-9 ,'\-&/]{2,79}$/

type Section = { label: string; text: string; charStart: number; charEnd: number }

function sectionize(text: string): Section[] {
  const sections: Section[] = []
  let current: Section = { label: "Preamble", text: "", charStart: 0, charEnd: 0 }
  let offset = 0

  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    const clause = trimmed.match(CLAUSE_RE)
    const isHeading = clause || (trimmed.length > 0 && HEADING_RE.test(trimmed))
    if (isHeading) {
      if (current.text.trim()) {
        current.charEnd = offset
        sections.push(current)
      }
      const label = clause ? clause[1] : trimmed
      current = { label, text: line + "\n", charStart: offset }
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

export async function ingestDocx(matterDir: string, fileName: string, buffer: Buffer) {
  const docPath = path.join(matterDir, fileName)
  writeFileSync(docPath, buffer)

  const { value: text } = await mammoth.extractRawText({ buffer })
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
