---
name: playbook-nda
description: "Firm playbook: positions, fallbacks, and approved clause text for mutual NDAs."
---

This is an executable firm playbook for mutual non-disclosure agreements. Each
`##` section is one clause type. Text inside an ```approved fence is the
firm-approved replacement text — copy it byte-exact into the redline tool's
`replacement` arg. Text inside an ```approved-fallback fence is the firm's
fallback text, to be used only when its stated "when" condition is met.

## Definition of confidential information

**Preferred:** Confidential information is defined broadly to cover all
non-public business, technical, and financial information disclosed in any form,
whether or not marked as confidential.

```approved
"Confidential Information" means all non-public information disclosed by or on
behalf of a party (the "Disclosing Party") to the other party (the "Receiving
Party"), in any form and whether or not marked or identified as confidential,
including business, technical, financial, commercial, product, and customer
information, together with the existence and terms of this Agreement and the
fact that discussions between the parties are taking place. Information disclosed
orally or visually need not be summarized in writing to qualify as Confidential
Information.
```

**Fallbacks:** when the counterparty requires marking as a condition of
protection for written disclosures.

```approved-fallback
"Confidential Information" means all non-public information disclosed by or on
behalf of the Disclosing Party to the Receiving Party that is either marked or
identified as confidential at the time of disclosure, or that a reasonable
person would understand to be confidential given the nature of the information
and the circumstances of disclosure. The terms of this Agreement and the
existence of discussions between the parties are Confidential Information
regardless of marking.
```

**Unacceptable:** definition limited to information marked "Confidential" in
writing with no reasonable-person catch-all; exclusion of the terms and
existence of the Agreement from protection.

**Rationale:** A marking-only definition leaves oral disclosures and unmarked
materials unprotected, which is the most common leakage point in diligence.

## Confidentiality term

**Preferred:** Confidentiality obligations survive for three years from the date
of disclosure, with trade secrets protected for as long as they remain trade
secrets under applicable law.

```approved
The Receiving Party's obligations under this Agreement with respect to each item
of Confidential Information shall survive for a period of three (3) years from
the date that item was disclosed. Notwithstanding the foregoing, Confidential
Information that constitutes a trade secret under applicable law shall remain
subject to the obligations of this Agreement for as long as such information
remains a trade secret.
```

**Fallbacks:** when the counterparty insists on a single fixed term and rejects
an open-ended trade-secret carve-out.

```approved-fallback
The Receiving Party's obligations under this Agreement shall survive for a
period of five (5) years from the date of disclosure of each item of
Confidential Information, after which such obligations shall expire.
```

**Unacceptable:** a term shorter than two years; an unqualified perpetual
confidentiality obligation covering all information rather than only trade
secrets.

**Rationale:** Three years matches the clause-library balanced position;
collapsing trade secrets into a fixed term forfeits indefinite statutory
protection, while perpetual blanket terms are administratively unworkable.

## Exclusions

**Preferred:** Standard exclusions for information that is public, independently
developed, already known, or lawfully received from a third party without a duty
of confidentiality.

```approved
Confidential Information does not include information that the Receiving Party
can demonstrate by competent evidence: (a) is or becomes generally available to
the public other than through a breach of this Agreement by the Receiving Party;
(b) was rightfully known to the Receiving Party without restriction prior to its
disclosure by the Disclosing Party; (c) is independently developed by the
Receiving Party without use of or reference to the Confidential Information; or
(d) is rightfully received by the Receiving Party from a third party without a
duty of confidentiality and without breach of this Agreement.
```

**Unacceptable:** an exclusion for information the Receiving Party "believes" to
be public; omission of the "without use of or reference to" qualifier on
independent development; an exclusion for information disclosed to the Receiving
Party's affiliates.

**Rationale:** These four exclusions are the universally accepted set; broadening
them (especially weak independent-development language) lets a receiving party
launder protected information out of scope.

## Return or destruction

**Preferred:** On request or termination, the Receiving Party returns or destroys
Confidential Information and certifies destruction, with a limited carve-out for
archival and legal-hold copies that remain subject to confidentiality.

```approved
Upon the Disclosing Party's written request or upon termination of this
Agreement, the Receiving Party shall promptly return or destroy all Confidential
Information in its possession or control and, upon request, certify such
destruction in writing. The Receiving Party may retain copies of Confidential
Information to the extent required by applicable law, regulation, or bona fide
internal record-retention policy, and copies created by routine automated backup
systems, provided that all such retained copies remain subject to the
confidentiality obligations of this Agreement for so long as they are retained.
```

**Unacceptable:** no destruction-certification obligation; an unlimited retention
right untethered from law or routine backup; retained copies released from
confidentiality obligations.

**Rationale:** The retention carve-out should be narrow and explicitly keep
retained copies under obligation; an open-ended retention right defeats the
return remedy.

## Permitted disclosures

**Preferred:** Disclosure compelled by law or legal process is permitted, subject
to prompt notice to the Disclosing Party (where lawful) and cooperation to seek
protective treatment.

```approved
If the Receiving Party is required by law, regulation, or valid legal process to
disclose any Confidential Information, it may do so provided that, to the extent
legally permitted, it gives the Disclosing Party prompt prior written notice so
that the Disclosing Party may seek a protective order or other appropriate
remedy, and discloses only that portion of the Confidential Information that it
is legally required to disclose. The Receiving Party shall reasonably cooperate,
at the Disclosing Party's expense, with the Disclosing Party's efforts to obtain
confidential treatment for the disclosed information.
```

**Fallbacks:** when the counterparty cannot commit to pre-disclosure notice for
regulatory or supervisory requests.

```approved-fallback
If the Receiving Party is required by law, regulation, or valid legal process to
disclose any Confidential Information, it may do so, and shall, to the extent
legally permitted and reasonably practicable, notify the Disclosing Party of the
required disclosure. No notice is required where the disclosure is made to a bank
regulatory or supervisory authority in the course of its routine examination or
oversight and is not targeted at the Disclosing Party.
```

**Unacceptable:** permitted disclosure with no notice obligation of any kind; a
right to disclose the entire body of Confidential Information rather than only the
portion legally required.

**Rationale:** Notice and minimization let the Disclosing Party defend its
information; a blanket compelled-disclosure right with no notice removes any
opportunity to seek protective treatment.

## Injunctive relief

**Preferred:** The parties acknowledge that breach may cause irreparable harm and
that the non-breaching party may seek injunctive relief without posting a bond, in
addition to other remedies.

```approved
The Receiving Party acknowledges that any breach or threatened breach of this
Agreement may cause the Disclosing Party irreparable harm for which monetary
damages would be an inadequate remedy. Accordingly, in addition to any other
remedies available at law or in equity, the Disclosing Party shall be entitled to
seek injunctive or other equitable relief to prevent or restrain any such breach
or threatened breach, without the necessity of posting a bond or proving actual
damages.
```

**Fallbacks:** when the counterparty's jurisdiction or policy requires that bond
be left to the court's discretion.

```approved-fallback
The Receiving Party acknowledges that any breach or threatened breach of this
Agreement may cause the Disclosing Party irreparable harm for which monetary
damages would be an inadequate remedy, and that the Disclosing Party shall be
entitled to seek injunctive or other equitable relief in addition to any other
remedies available at law or in equity, subject to the requirements of applicable
law regarding the posting of any bond.
```

**Unacceptable:** clause that requires the Disclosing Party to prove actual
damages before obtaining equitable relief; mutual waiver of the right to seek
injunctive relief.

**Rationale:** Injunctive relief is the only meaningful remedy for confidentiality
breach, since damages are hard to quantify; the no-bond formulation is the firm's
preference but is genuinely negotiable.

## Governing law

**Preferred:** A neutral, named jurisdiction with exclusive venue in that
jurisdiction's courts; injunctive relief preserved for confidentiality breaches.

```approved
This Agreement shall be governed by and construed in accordance with the laws of
the State of [insert governing law state], without regard to its conflict-of-laws
principles. The parties consent to the exclusive jurisdiction and venue of the
state and federal courts located in [insert venue county and state] for any
dispute arising out of or relating to this Agreement, except that either party
may seek injunctive relief in any court of competent jurisdiction.
```

**Fallbacks:** when the counterparty rejects the firm's home jurisdiction and a
neutral forum is acceptable.

```approved-fallback
This Agreement shall be governed by and construed in accordance with the laws of
the State of Delaware, without regard to its conflict-of-laws principles, and the
parties consent to the exclusive jurisdiction and venue of the state and federal
courts located in Delaware, except that either party may seek injunctive relief in
any court of competent jurisdiction.
```

**Unacceptable:** governing law of the counterparty's home jurisdiction where it
is not neutral; a carve-out stripping the right to seek injunctive relief in any
competent court; mandatory arbitration with no equitable-relief exception.

**Rationale:** A neutral, named jurisdiction with preserved injunctive relief
matches the clause-library disputes position; Delaware is the firm's standard
neutral fallback.

## Non-solicitation

**Preferred:** A mutual, twelve-month no-solicit limited to employees who became
known through the engagement, with the usual general-advertising and post-
employment carve-outs.

```approved
During the term of this Agreement and for a period of twelve (12) months
thereafter, neither party shall directly solicit for employment any employee of
the other party with whom it had contact or who became known to it in connection
with the discussions contemplated by this Agreement; provided that this
restriction shall not prohibit (a) general solicitations of employment not
specifically directed at such employees, including through job postings or
recruiting agencies, or (b) the hiring of any employee who responds to such a
general solicitation or who approaches a party on his or her own initiative.
```

**Unacceptable:** a non-solicit longer than twenty-four months; a one-sided
restriction binding only one party; a no-hire (as opposed to no-solicit)
provision; omission of the general-advertising carve-out.

**Rationale:** Non-solicitation is not a confidentiality term and should be
narrow, mutual, and time-limited; no-hire provisions and missing
general-advertising carve-outs are routinely unenforceable and overbroad.
