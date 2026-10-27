---
name: backend-quality
description: Perform a read-only quality review of NestJS backend code and its relevant API contract.
---

# Backend Quality Review

Use this skill for a requested Backend code review or targeted quality audit. Read the applicable
requirements through `PROJECT_SOURCES.md`, relevant local specs and contracts, changed code, and
tests. Identify source revisions and mark a requirement unverified when its source is unavailable.

Report actionable findings first, ordered by severity, with file and line evidence, impact, and a
clear remediation direction. Check correctness, module/service boundaries, input validation,
authentication and authorization where required, sensitive data exposure, database/query and
transaction safety where present, error handling, external AI failure handling where present,
contract compatibility, and relevant test gaps. Only report checks applicable to the code under
review; do not turn planned features into requirements or produce style-only findings.

This is a read-only review. Do not edit code, tests, or contracts. Do not update CNPM-Docs or
commit/push.
