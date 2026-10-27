---
name: prisma-data
description: Review or change a Prisma/database layer only for an explicitly scoped and approved task.
---

# Prisma and Database Work

Use this skill only when the task explicitly covers database design, Prisma, queries, or
migrations. First consult `PROJECT_SOURCES.md` and the relevant approved requirements, then inspect
the installed dependencies, current schema, migrations, and actual target environment. This
Backend baseline does not currently configure Prisma or PostgreSQL; do not install or assume them
without an approved task.

For an approved change, analyze relationships, constraints, indexes, transactions, access
controls, and data exposure. Validate and authorize inputs before building queries, and avoid
returning persistence entities when they expose fields outside the API contract. Describe migration
effects and data-loss risks before execution.

Never run `migrate reset`, destructive `db push`, database deletion, or seeding against important
data without explicit authorization and a reviewed recovery plan. Add relevant tests for approved
data behavior and report validation. Do not modify CNPM-Docs or commit/push unless requested.
