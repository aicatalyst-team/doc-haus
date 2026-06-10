---
name: drafting
description: How to draft a new document into the matter — template-first via list-templates/draft-document, from scratch only when no template fits. Use whenever asked to create, draft, or prepare a new document.
---

Drafting creates a NEW .docx in the matter. Changing an existing document is the
redline workflow, not this one.

<workflow>
1. **Gather the terms first.** Parties (full legal names), effective date,
   durations, jurisdiction, and anything else the document type needs. Take them
   from the conversation and the matter's existing documents (`search-document`);
   ask the lawyer only for what is genuinely missing — and rather than blocking
   on minor blanks, draft with placeholders left in and say which ones remain.
2. **Template first.** Call `list-templates`. If a template matches the request,
   use it: map each gathered term to one of the template's placeholders and call
   `draft-document` with `template` + `fills`. Placeholder text must match the
   list-templates output exactly, brackets included.
3. **From scratch only when no template fits.** Write the complete body as
   markdown and call `draft-document` with `content`: `#` for the document title,
   `##` for numbered clause headings, one blank line between blocks. Use the
   standard clause structure for the document type and the balanced positions in
   the clause-library skill as the baseline. Mark anything you cannot know with a
   bracketed instruction placeholder — `[insert client name]`, `[insert term in
   years]`. Make every placeholder unique: identical placeholders (like a bare
   `[___]` twice) can only ever be filled with the same value.
4. **Report.** Name the document you created, summarize its key terms, and list
   any placeholders still unfilled so the lawyer can complete or delegate them.
</workflow>

<rules>
- Pick a descriptive file name: counterparty + document type, e.g.
  "Acme Corp NDA.docx".
- Never overwrite: if the name is taken, pick another (e.g. append "v2").
- After drafting, refinements go through the normal editing tools
  (tracked-changes / redline) on the new document.
</rules>
