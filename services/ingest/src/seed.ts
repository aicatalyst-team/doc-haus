import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createMatter } from "./matter"
import { ingestDocument } from "./ingest"

// Seeds the demo matter: a wholly fictional letter of engagement, ingested
// through the real pipeline so a first-time user lands on a matter that already
// answers cited questions and runs a legal review — no upload, no data of their
// own required.
//
//   cd services/ingest && bun run seed
//
// It also writes the generated .docx to repo `demo/` so the same file can be
// dropped into a new matter through the web UI. Everything below is invented;
// Aldgate & Crane LLP and Aldgate Mills Limited do not exist.

const DOC_NAME = "Letter of Engagement — Aldgate Mills.docx"
const MATTER_TITLE = "Aldgate Mills — Engagement (Demo)"

// Each clause is a bold "N. Title" heading paragraph followed by its body. The
// ingest sectionizer keys sections off the leading clause number, so a citation
// like [Letter of Engagement — Aldgate Mills § 9] resolves to clause 9.
const CLAUSES: [string, string][] = [
  [
    "1. Scope of our work",
    "We will advise on and complete the acquisition of the long leasehold of Unit 5, Saffron Wharf, London E1, including reviewing the agreement for lease and the lease, reporting to you on title and on the principal commercial terms, raising and reviewing enquiries, and dealing with completion and post-completion registration at HM Land Registry. We will not advise on the commercial merits of the transaction, on tax beyond Stamp Duty Land Tax, or on the physical condition of the property, which are outside the scope of this engagement unless separately agreed in writing.",
  ],
  [
    "2. The people acting for you",
    "Your matter will be handled by Daniel Crane, Partner (charged at £480 per hour), with support from Priya Nair, Associate (charged at £290 per hour). Routine work may be delegated to a trainee or paralegal at £160 per hour where that is cost-effective. We will tell you promptly if the person responsible for your matter changes.",
  ],
  [
    "3. Our fees",
    "Our fees are calculated principally by reference to the time spent at the hourly rates in clause 2. Our current estimate for this matter is £14,500 plus VAT and disbursements. An estimate is not a fixed quotation; if it becomes likely that the estimate will be exceeded, we will tell you before further significant costs are incurred and agree a revised estimate with you.",
  ],
  [
    "4. Disbursements",
    "Disbursements are expenses we pay on your behalf, such as Land Registry fees, search fees, and Stamp Duty Land Tax. We will normally ask you to put us in funds for substantial disbursements before we incur them.",
  ],
  [
    "5. Billing and payment",
    "We will deliver interim bills monthly as the matter progresses, with a final bill on completion. Each bill is payable within 14 days of its date. We reserve the right to charge interest on bills not paid within that period at 4% per year above the base rate of the Bank of England, calculated from the date of the bill until payment.",
  ],
  [
    "6. Money on account",
    "We ask you to pay £5,000 on account of our fees and disbursements before we begin substantive work. We will hold that money in our client account and apply it against our bills, asking you to top it up as the matter proceeds.",
  ],
  [
    "7. Your responsibilities",
    "You agree to give us clear and timely instructions, to provide the documents and information we reasonably request, to put us in funds as agreed, and to tell us promptly of any change to the transaction or your instructions. Delay in any of these may affect our estimate and the timetable.",
  ],
  [
    "8. Confidentiality",
    "We will keep your affairs confidential, save where disclosure is required by law or by our regulator, or where you authorise it. Our duty of confidentiality continues after this engagement ends.",
  ],
  [
    "9. Limitation of liability",
    "Our total aggregate liability to you arising out of or in connection with this engagement, whether in contract, tort (including negligence), breach of statutory duty or otherwise, is limited to £3 million, which corresponds to our professional indemnity insurance cover. We are not liable for any indirect or consequential loss, or for loss of profit, revenue, or anticipated savings. Nothing in this clause limits any liability that cannot lawfully be limited, including liability for death or personal injury caused by negligence or for fraud.",
  ],
  [
    "10. Conflicts of interest",
    "We have checked for conflicts of interest and are not aware of any that prevent us acting for you. If a conflict arises during the engagement, we will tell you and explain the options, which may include our ceasing to act.",
  ],
  [
    "11. Data protection",
    "We process your personal data as a controller in order to act for you, in accordance with the UK GDPR and the Data Protection Act 2018. We retain your file for seven years after the matter closes, after which we may destroy it without further reference to you. Our privacy notice gives further detail.",
  ],
  [
    "12. Termination",
    "You may end this engagement at any time by written notice. We may cease to act only for good reason, such as a conflict of interest, non-payment of our bills, or your failure to give instructions, and on giving you reasonable written notice. On termination you remain liable for our fees and disbursements incurred up to that point.",
  ],
  [
    "13. Complaints",
    "We aim to provide a high standard of service. If you are unhappy with our service or a bill, please raise it first with Daniel Crane. If we cannot resolve it, you may be entitled to complain to the Legal Ombudsman, normally within six months of our final response. You may also have the right to challenge a bill under the Solicitors Act 1974.",
  ],
  [
    "14. Regulation",
    "Aldgate & Crane LLP is authorised and regulated by the Solicitors Regulation Authority. We are bound by the SRA Standards and Regulations, which are available from the SRA.",
  ],
  [
    "15. Governing law",
    "This engagement and our terms of business are governed by the law of England and Wales, and the courts of England and Wales have exclusive jurisdiction over any dispute arising out of them.",
  ],
  [
    "16. Acceptance",
    "If these terms are acceptable, please sign and date below and return one copy to us. Work you ask us to carry out, or the payment of money on account, will in any event be taken as your acceptance of these terms.",
  ],
]

function body(text: string) {
  return new Paragraph({ children: [new TextRun(text)], spacing: { after: 160 } })
}

function clause([title, text]: [string, string]) {
  return [
    new Paragraph({ children: [new TextRun({ text: title, bold: true })], spacing: { before: 160, after: 60 } }),
    body(text),
  ]
}

const doc = new Document({
  sections: [
    {
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("ALDGATE & CRANE LLP")] }),
        body("Solicitors — 14 Saffron Court, London EC3N 4QX"),
        body("Aldgate Mills Limited — FAO: Ms R. Okafor, Director — 27 Wharf Road, London E1 8GW"),
        body("3 June 2026 — Our ref: A&C/2026-0042"),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("LETTER OF ENGAGEMENT")] }),
        body("Dear Ms Okafor,"),
        body(
          "Re: Proposed acquisition of the long leasehold of Unit 5, Saffron Wharf, London E1. Thank you for instructing Aldgate & Crane LLP. This letter sets out the basis on which we will act for you. Please read it, and let us know if anything is unclear, before signing and returning the acceptance at the end.",
        ),
        ...CLAUSES.flatMap(clause),
        body("Yours sincerely,"),
        body("Daniel Crane — Partner, for and on behalf of Aldgate & Crane LLP"),
        body("Signed (client): ____________________   Date: ____________"),
        body("Ms R. Okafor, for and on behalf of Aldgate Mills Limited"),
      ],
    },
  ],
})

const buffer = await Packer.toBuffer(doc)

// Keep a copy in repo demo/ so the same .docx can be uploaded through the UI.
const demoDir = path.join(import.meta.dir, "..", "..", "..", "demo")
mkdirSync(demoDir, { recursive: true })
writeFileSync(path.join(demoDir, "Letter-of-Engagement-Aldgate-Mills.docx"), buffer)

const matter = createMatter(MATTER_TITLE, "A&C/2026-0042")
const result = await ingestDocument(matter.dir, DOC_NAME, Buffer.from(buffer))
console.log(`Seeded matter "${matter.title}" (${matter.id})`)
console.log(`Ingested ${DOC_NAME}: ${result.sections} sections, ${result.chunks} chunks`)
console.log(`Open the web app and select "${MATTER_TITLE}" to try cited Q&A and a legal review.`)
