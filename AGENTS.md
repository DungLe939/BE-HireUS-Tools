# HireUS Backend Agent Instructions

## Purpose and verified baseline

This repository is the NestJS backend for HireUS Tools. The current baseline is NestJS 12,
TypeScript, Node.js, npm, CommonJS, and Jest. Application code lives in `src/`; the repository
currently contains only the NestJS starter module, controller, service, and bootstrap. Do not
infer that planned capabilities are already implemented.

## Business sources and scope

- Before a business feature, read `PROJECT_SOURCES.md` and the relevant CNPM-Docs sources.
- Follow `CNPM-Docs/.agents/rules/source-of-truth.md` for evidence and source precedence.
- Do not infer functionality beyond the confirmed Proposal and task acceptance criteria.
- Distinguish confirmed decisions from proposed or planned work, implementation, verification,
  submission, and approval.
- If a relevant source changes, re-read it before changing implementation. If sources conflict
  and the difference affects behavior, report the conflict and ask for resolution.
- If CNPM-Docs is inaccessible, mark business requirements unverified and request the relevant
  path or file; continue independent technical work where possible.
- Never edit the CNPM-Docs repository during a Backend task. Report any shared-document changes
  that should be carried back to that repository.
- Local specifications in `.specify/` or `specs/` must cite the applicable central source and
  must not contradict it.

## NestJS and API conventions

- Keep controllers at the HTTP boundary; put application behavior in providers/services and
  organize features with NestJS modules.
- Use request DTOs and the repository's configured validation mechanism. Do not claim validation,
  authentication, or authorization is active unless it is implemented and covered by an approved
  requirement.
- Backend owns the REST API contract it exposes. See `contracts/README.md` for ownership and
  change coordination. Do not invent endpoints, request fields, response fields, or error formats.
- Preserve established API behavior. Call out breaking changes and Frontend impact before treating
  a contract change as complete.
- Do not expose persistence entities or sensitive data directly when that could disclose fields
  outside the approved contract.

## Data, security, and external services

- Check the actual repository setup and the approved feature spec before adding a database, ORM,
  schema, migration, or external service. PostgreSQL/Prisma and AI services are not configured in
  the current Backend baseline.
- Never hardcode secrets or expose AI/provider credentials to the Frontend. Validate external
  service responses and handle failure/timeout cases when an approved feature requires integration.
- Do not construct database queries from unvalidated input. Do not run destructive database
  operations, resets, or migrations without explicit authorization and a reviewed impact.
- Do not log passwords, access tokens, secrets, or sensitive personal data.

## Development workflow

- Inspect existing code, tests, and applicable Spec Kit artifacts before changing a feature.
- Add or update Jest tests for behavior changes when the task calls for implementation and tests.
  Use `npm test` and `npm run build` for the relevant validation; report exactly what ran.
- Keep changes within the requested scope and avoid unrequested dependencies or services.
- Do not commit or push unless explicitly requested.
