# HireUS Backend Constitution

**Status: DRAFT — NOT RATIFIED**

## Core Principles

### I. Canonical Sources and Decision Provenance

CNPM-Docs is authoritative for business requirements and shared cross-repository decisions. `PROJECT_SOURCES.md` identifies relevant sources; follow the source hierarchy defined in CNPM-Docs. A clear, scoped direct user request authorizes work within that task. Keep confirmed decisions, proposals, plans, implementation, test results, submission, and approval as separate states. A plan is not evidence that work is implemented or approved. This prevents intended future work from being mistaken for current behavior.

### II. Scope and REST API Contract Ownership

Changes MUST remain within the explicit task and its applicable requirements. Large features and material business behavior require sufficiently clear requirements and acceptance criteria; a small bug fix does not require the full Spec Kit workflow. Do not turn Spec Kit defaults into project requirements. Backend owns the REST API contract it exposes, and Frontend consumes the contract agreed for the feature. Do not invent endpoints, DTO fields, authentication behavior, response schemas, or error formats. OpenAPI is preferred when a contract is approved, but is not mandatory. API versioning, error format, and concrete authentication policy remain pending decisions.

### III. NestJS Responsibilities

Controllers MUST handle the HTTP boundary and delegate application behavior to providers or services. Modules MUST define clear feature boundaries. Use DTOs and the validation mechanism configured for the repository; do not claim validation or authorization is active until it is implemented. Avoid unnecessary abstractions. Do not upgrade a framework or add dependencies without an explicit task or confirmed project decision.

### IV. Data, Security, and External Integrations

Protect credentials and sensitive user data from exposure in responses, logs, and client code. Verify the actual data-access setup before changing persistence. Validate untrusted input before using it in queries. Do not run destructive database operations or migrations without explicit authorization and a reviewed impact. External AI integrations, when required by an approved feature, MUST remain server-side, validate provider responses, and handle relevant timeout and failure paths. Do not treat planned database, ORM, or AI technologies as configured by their appearance in a proposal.

### V. Verification and Controlled Changes

Run checks appropriate to the changed behavior using tools configured in each affected repository, and report the exact checks and results. Backend checks use the configured Jest, TypeScript, and build setup. When a task spans Frontend, use its configured lint, TypeScript, and build checks; do not assume a Frontend test framework exists. The Proposal's coverage target of 70% is a plan, not a mandatory quality gate. Do not introduce coverage thresholds or test frameworks without a confirmed decision. Keep changes within scope and do not commit or push unless explicitly requested.

### VI. Learning-Oriented Development

For significant code changes, explain in Vietnamese the goal and approach, the roles of important files, the main processing flow, notable logic, and how to verify the result. Explain solution choices and trade-offs when they matter. Keep explanations concise for obvious changes, and keep long tutorial material out of production source code. This makes implementation review useful to learners without obscuring the code.

## Technical Constraints

The affected repository's manifests, lockfile, and source code define its configured framework, runtime, and dependencies; verify them before proposing changes. A technology described only as planned in CNPM-Docs is not automatically part of the implementation. Framework upgrades, new services, and new dependencies require an explicit task or confirmed project decision. Resolve pending decisions before implementing behavior that depends on them.

## Development Workflow

This constitution contains durable principles. `AGENTS.md` contains repository-level coding and development instructions; `PROJECT_SOURCES.md` explains how to find and record business sources; `contracts/README.md` defines the local API-contract workflow; and `SKILL.md` files provide task-specific procedures. CNPM-Docs owns business documentation and shared project decisions. Do not copy Proposal or other product documentation into Backend, and do not update CNPM-Docs during a Backend task. Report shared documentation changes for its owner to apply. Local specifications MUST reference the applicable central requirement and MUST NOT contradict it.

For a significant feature, resolve material requirements and acceptance criteria before implementation. Small, reversible technical assumptions may be used only when they do not change business behavior, security, data, or API contracts; state them clearly. If a relevant source changes, verify it before updating dependent implementation. Continue independent work when a source is unavailable, and identify what remains unverified.

## Governance

This constitution governs Backend engineering practices. It does not replace CNPM-Docs as the authority for business requirements or shared decisions. Amend this document only for an explicit project decision or requested update. Keep it in Draft/Unratified status until the project owner explicitly approves it; record a ratification date only after that approval. While it is a draft, use `0.x.y` versions. Apply semantic versioning: PATCH for wording or clarifications that do not change obligations, MINOR for additive principles or material expansion, and MAJOR for incompatible principle removals or redefinitions. Record the amendment date for each content change. Review relevant work against these principles; keep detailed checklists and task procedures in the repository instructions and skills.

**Version**: 0.2.0 | **Ratified**: TODO(RATIFICATION_DATE): awaiting explicit project-owner approval | **Last Amended**: 2026-10-28
