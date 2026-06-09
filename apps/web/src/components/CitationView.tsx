import type { Citation } from "../api/opencode"

export default function CitationView({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null
  return (
    <div>
      {citations.map((c, i) => (
        <div className="citation" key={`${c.docPath}-${c.charStart}-${i}`}>
          <div className="ref">
            [{c.documentName} § {c.section}]
          </div>
          <div className="excerpt">{c.excerpt}</div>
        </div>
      ))}
    </div>
  )
}
