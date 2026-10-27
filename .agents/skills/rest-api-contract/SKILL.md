---
name: rest-api-contract
description: Design, review, or update a Backend-owned REST API contract from approved requirements.
---

# REST API Contract Governance

Use this skill when a task defines, reviews, or changes a REST endpoint or its request/response
contract.

Read `PROJECT_SOURCES.md`, the relevant approved requirement and acceptance criteria, the current
contract, and any affected Frontend consumer. Backend owns the contract it exposes; CNPM-Docs owns
the underlying business requirement. Record the source revision when synchronizing repositories.

For each operation, verify method/path semantics, request and response fields, status codes, error
behavior, and authentication/authorization requirements supported by the source. Consider
backward compatibility, pagination/filtering where required, and consumer impact. Do not invent an
endpoint or field to fill a requirements gap; surface the gap for resolution.

Keep the contract in `contracts/` and align it with the implementation. OpenAPI is the preferred
format once an API is approved, but do not add Swagger packages or fabricate schemas without a
task authorizing them. Do not edit CNPM-Docs; report shared-document changes separately.
