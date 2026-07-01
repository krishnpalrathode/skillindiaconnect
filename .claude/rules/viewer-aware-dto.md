# Viewer-aware DTOs (privacy enforced at the API layer)

All candidate (and company) serialization passes through viewer-aware mappers
that take a viewer context — `candidate-self` | `employer` | `admin` |
`pdf-renderer` — and OMIT fields per the subject's privacy toggles AT THE API
LAYER. Never rely on the UI to hide data.

Candidate, employer context:

- `showPhone = false` → phone omitted.
- `showReligion = false` (default) → religion omitted.
- Admin context includes both. Internal application notes are NEVER serialized to
  employer or candidate contexts.

Resume PDF is a viewer (`pdf-renderer`) and respects Resume Settings at
GENERATION time: `showPhone`, `showReligion` (default off), `showFatherName`,
`showPassportNumber` (default off). Hidden fields must be ABSENT FROM THE PDF
BYTES, not merely hidden in the preview.

Hard rule: "Email to myself" sends the resume ONLY to the candidate's account
email — never an arbitrary address from the request.

These are tested by asserting on raw JSON and on parsed PDF bytes, not on
rendered output.
