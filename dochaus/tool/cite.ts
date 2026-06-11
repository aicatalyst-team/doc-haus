import { tool } from "@opencode-ai/plugin"
import { existsSync } from "node:fs"
import { formatCitations, type DocumentCitation } from "../lib/citations"
import { findQuote, liveText } from "../lib/extract"

// doc.haus citation-anchoring tool. Before an agent puts a quotation from a
// matter document into its answer, it calls this tool with the verbatim text;
// the tool re-extracts the live document and confirms the quote actually appears
// in it, returning a verified citation the model can present. The legal plugin
// re-checks the same span on the way out, so a quote that does not anchor here is
// a quote the lawyer must never see.

export default tool({
  description:
    "Anchor a quotation against a matter document before you quote it in an answer. Call this for EVERY passage you intend to quote from a matter document. The quote must be copied verbatim from the document: no paraphrase, no added or removed ellipses, no edits. If this tool cannot verify the quote, do not present that quotation to the user — re-read the document and quote only text the tool confirmed.",
  args: {
    docPath: tool.schema
      .string()
      .describe("Absolute path of the matter document, exactly as returned by search-document or read-document."),
    documentName: tool.schema.string().describe("Human-readable name of the document."),
    quote: tool.schema
      .string()
      .min(10)
      .max(600)
      .describe("The verbatim text copied from the document, with no paraphrase or added ellipses."),
    reason: tool.schema.string().describe("Why this passage supports the claim you are making."),
    confidence: tool.schema
      .number()
      .int()
      .min(1)
      .max(5)
      .describe(
        "How strongly the passage supports the claim: 5 = verbatim quote that directly and unambiguously supports it; 3 = supports it but requires interpretation or context; 1 = tangential or weak support.",
      ),
    context: tool.schema
      .string()
      .optional()
      .describe("Optional: the sentence(s) immediately around the quote, for the reader."),
  },
  async execute(args) {
    if (!existsSync(args.docPath)) {
      return `${args.documentName} is not in this matter (no file at ${args.docPath}). Do not use this quotation. Confirm the document with search-document or read-document before quoting it.`
    }

    const match = findQuote(await liveText(args.docPath), args.quote)
    if (!match) {
      return `The quoted text does not appear in ${args.documentName}. Do not use this quotation — re-read the document with read-document or search-document and quote only text it returns verbatim.`
    }

    const citation: DocumentCitation = {
      documentName: args.documentName,
      docPath: args.docPath,
      section: "cited passage",
      // Store the raw matched span, not the model's input, so the plugin's exact
      // slice check against the live document passes on the way out.
      excerpt: match.excerpt,
      charStart: match.start,
      charEnd: match.end,
      reason: args.reason,
      confidence: args.confidence,
      context: args.context,
      verified: true,
    }

    return {
      title: `Verified quote in ${args.documentName}`,
      output: `${formatCitations([citation])}\n\nVerified verbatim against the live document — safe to quote.`,
      metadata: { citations: [citation] },
    }
  },
})
