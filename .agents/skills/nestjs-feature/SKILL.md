---
name: nestjs-feature
description: Implement a scoped NestJS backend feature or module from approved requirements and acceptance criteria.
---

# NestJS Feature Implementation

Use this skill for implementing a requested NestJS feature or module. Do not use it to infer or
select new business capabilities.

Before coding, read `PROJECT_SOURCES.md`, the relevant CNPM-Docs sources, acceptance criteria,
current Spec Kit artifacts, and existing module structure. Verify source revisions when the
referenced documents have changed. If a decision affects behavior, authorization, or the API
contract and remains unresolved, report the gap and ask; continue independent work.

Keep HTTP handling in controllers, application behavior in services/providers, and boundaries in
NestJS modules. Use DTOs with the validation mechanism actually configured in the repository. Add
authentication, authorization, database, or AI integration only when the approved feature defines
it. Avoid unnecessary abstractions and dependencies.

Update `contracts/` when the approved change affects an exposed API, and identify Frontend impact.
Add relevant Jest coverage and run the checks required by the task. Never edit CNPM-Docs, run
destructive database operations, or commit/push unless explicitly requested.
