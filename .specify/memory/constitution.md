<!--
Sync Impact Report
Version change: unversioned scaffold → 0.1.0 (initial draft)
Modified principles: five placeholder slots replaced with source, scope, architecture, security, and verification rules.
Added sections: Technical Constraints; Development Workflow.
Removed sections: template examples and placeholder-only section headings.
Follow-up TODO: formal ratification date and approval are pending.
-->
# HireUS Backend Constitution

## Core Principles

### I. Canonical Sources and Decision Provenance
Business requirements, product scope, and cross-repository decisions MUST be verified through `PROJECT_SOURCES.md` and the referenced CNPM-Docs source. Follow `.agents/rules/source-of-truth.md` when sources differ. Clearly distinguish confirmed decisions from proposals, plans, implementation, tests, and approval. Do not promote a planned item into an implemented or approved fact.

### II. Scope and API Contract Control
A backend feature MUST trace to an approved requirement and acceptance criteria. Do not invent endpoints, fields, or behavior to fill gaps. Backend owns the REST API contract it exposes; identify compatibility and Frontend impact when changing it. Keep the technical contract in this repository and product requirements in CNPM-Docs.

### III. NestJS Responsibilities
Controllers MUST handle the HTTP boundary and delegate application behavior to providers/services. Modules MUST define clear feature boundaries. Use DTOs and the validation mechanisms configured for the repository. Avoid unnecessary abstractions and dependencies; do not claim a validation, authentication, or authorization policy is active until it is configured and supported by an approved requirement.

### IV. Data, Security, and External Integrations
Do not expose credentials or sensitive user data in responses, logs, or client code. External AI integrations MUST remain server-side, validate external responses, and handle timeout/failure paths when an approved feature requires them. Verify the actual database and ORM setup before changing data access. Do not run destructive database commands or migrations without explicit authorization and a reviewed impact.

### V. Verification and Controlled Changes
Use the repository's Jest setup for relevant behavior tests and run the applicable build/type checks when requested or needed to verify a code change. Report the checks run and any limits. Keep changes within the task scope. Do not commit or push unless explicitly requested.

## Technical Constraints

The verified baseline is NestJS, TypeScript, Node.js, npm, CommonJS, and Jest. The application currently contains only the NestJS starter module, controller, service, and bootstrap. PostgreSQL, Prisma, Swagger/OpenAPI packages, and AI integrations are not configured in this repository. CNPM-Docs may describe them as planned technology; treat them as future work until an approved task and repository state confirm adoption. Do not add services or dependencies solely because they appear in a proposal.

## Development Workflow

For a business feature, read `PROJECT_SOURCES.md`, the relevant CNPM-Docs sources, the current Spec Kit artifacts, and the existing code before implementation. Re-verify the source revision when source documents change. If required documents cannot be accessed, mark the business requirements unverified and request the relevant path or file; continue independent technical work where possible. Never update CNPM-Docs while working in Backend. If shared documentation needs a change, report the proposed change for the Docs repository. Local specifications MUST reference the applicable central requirement and MUST NOT contradict it.

## Governance

This constitution governs Backend engineering practices; it does not replace or duplicate product documentation. CNPM-Docs remains authoritative for product scope and cross-repository decisions. If a conflict remains after applying its source hierarchy and current user instructions, describe the conflict and ask for resolution before dependent implementation. Amend this constitution only when requested or when an explicit project decision changes. Record a version change and amendment date; do not imply formal ratification while the ratification date is unresolved.

**Version**: 0.1.0 | **Ratified**: TODO(RATIFICATION_DATE): pending project owner approval | **Last Amended**: 2026-10-27
