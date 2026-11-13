# Backend API Contracts

Backend owns the contract for each REST API endpoint it exposes. Frontend consumes the contract
that has been reviewed and approved for the relevant feature. The domain requirement remains in
Docs-HireUS-Tools; this directory is for the technical HTTP interface maintained with Backend.

The current VMI contract is [vmi.openapi.yaml](vmi.openapi.yaml), version 0.9.0.
It adds `rawText` and `refined` to transcription drafts, preserving `text` and
`language`. Optional refinement failures return the original draft with HTTP 200;
existing STT errors remain unchanged. No Swagger dependency is required.

For each approved contract change:

1. Consult `PROJECT_SOURCES.md`, the applicable central requirement, and the current local spec.
2. Define the HTTP method and path, request and response shapes, status codes, error behavior, and
   authentication/authorization requirements supported by that feature's approved source.
3. Check backward compatibility and identify Frontend consumer impact before changing an existing
   contract.
4. Keep the contract and its implementation aligned. Record the Docs-HireUS-Tools source revision and the
   Backend contract version or commit when synchronizing with another repository.
5. Report missing or conflicting requirements instead of filling them with inferred behavior.

Before handoff or push, review and update technical guidance and summaries affected by the change,
following the team's `docs-maintenance` workflow and the documentation repository's instructions.
Change product requirements only when supported by a new decision, not to accommodate incorrect code.
Changes to other repositories beyond this documentation maintenance need a coordinated task.
