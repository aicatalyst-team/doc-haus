import { docxodus } from "./docxodus"
import type { RedlineRow } from "./db"

// Replay and bake pending redline proposals against a clean .docx.
//
// The canonical document on disk is always the accepted ("clean") state. A
// proposal records how to reproduce one edit — a surgical find/replace ('phrase')
// or a whole-paragraph rewrite ('clause') — located the same way the dochaus tools
// located it originally. We never store offsets: text is re-resolved against the
// live document every time, so edits stay valid as the document changes underneath.

type Session = ReturnType<Awaited<ReturnType<typeof docxodus>>["openDocxSession"]>

// Reproduce one proposal's edit on an open session. Throws with a reviewer-facing
// message when the anchor text can no longer be found (e.g. an earlier accept
// already rewrote the same passage) rather than corrupting the document.
function applyProposal(session: Session, row: RedlineRow) {
  if (row.scope === "clause") {
    const target = session.findByText(row.find_text, { ignoreWhitespace: true })
    if (!target) throw new Error(`Clause no longer found for redline #${row.id}: ${JSON.stringify(row.find_text)}`)
    const result = session.replaceText(target.id, row.new_text)
    if (!result.success) throw new Error(`Redline #${row.id} failed: ${result.error?.message ?? "unknown error"}`)
    return
  }

  const targets = session.findAllByText(row.find_text)
  if (!targets.length) throw new Error(`Text no longer found for redline #${row.id}: ${JSON.stringify(row.find_text)}`)
  const results = targets.flatMap((t) => session.replaceTextRange(t.id, row.find_text, row.new_text))
  const failed = results.find((r) => !r.success)
  if (failed) throw new Error(`Redline #${row.id} failed: ${failed.error?.message ?? "unknown error"}`)
}

// The redlined view the viewer renders: clean document compared against the same
// document with every pending proposal applied, so Docxodus emits native w:ins/w:del
// the browser paints green/red. With no pending rows the compare is a no-op and the
// clean document round-trips unchanged.
export async function buildRedlined(original: Uint8Array, rows: RedlineRow[]): Promise<Uint8Array> {
  const dx = await docxodus()
  if (!rows.length) return original
  const session = dx.openDocxSession(original, {})
  try {
    for (const row of rows) applyProposal(session, row)
    const modified = session.save()
    const authors = [...new Set(rows.map((r) => r.author))]
    return dx.compareDocuments(original, modified, { authorName: authors.length === 1 ? authors[0] : "doc.haus" })
  } finally {
    session.close()
  }
}

// Bake the given proposals into the clean document, returning new canonical bytes
// with the edits applied and no tracked changes — the new accepted state.
export async function bake(original: Uint8Array, rows: RedlineRow[]): Promise<Uint8Array> {
  const dx = await docxodus()
  const session = dx.openDocxSession(original, {})
  try {
    for (const row of rows) applyProposal(session, row)
    return session.save()
  } finally {
    session.close()
  }
}
