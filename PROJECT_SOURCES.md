# Project Sources

## Official documentation repository

`CNPM-Docs` is the separate source-of-truth repository for HireUS Tools business requirements,
the Project Proposal, shared plans, cross-repository design, and confirmed project decisions.

## Important source paths

Paths below are relative to the root of `CNPM-Docs`:

1. `.agents/rules/source-of-truth.md` — source hierarchy, evidence rules, and documentation scope.
2. `docs/Week01/Submission/Project_Proposal.md` and `.html` — proposal scope, technology, and plan;
   use according to the confirmation and conflict rules in the source-of-truth file.
3. `docs/PROJECT_CONTEXT.md` — navigation summary; it does not replace primary evidence.
4. `docs/Week01/Team_Decision/Material/HireUS_Implementation_Plan.md` — plan summary, not an
   approval record or proof that a feature was implemented.

For a specific task, also consult the relevant original course notice/template, meeting record,
or implementation evidence named by `source-of-truth.md`. Do not treat a downloaded or AI-written
summary as confirmation by itself.

## Providing sources to Codex

Make the `CNPM-Docs` checkout available in the Codex workspace. If it is checked out as a sibling
repository, `../CNPM-Docs` is a convenient relative location from Backend. Otherwise, attach the
relevant files or paste their contents and identify their repository-relative paths. Do not put a
machine-specific absolute path in tracked documentation.

If a required source cannot be accessed, state which source is unverified and ask for its path or
file. Do not infer requirements from its name or from a secondary summary. Continue work that does
not depend on the missing source.

## Confirmed and proposed decisions

Follow the precedence and evidence rules in `.agents/rules/source-of-truth.md`. Label information
as confirmed only when supported by the applicable source or current user instruction. Keep
proposals and plans labeled as proposed/planned; keep implementation, tests, submission, and
approval as separate states. A plan is not proof of completed work.

## Recording source revision

When a task depends on a particular source revision, record the `CNPM-Docs` Git commit SHA using
`git -C <CNPM-Docs checkout> rev-parse HEAD`, the repository-relative files consulted, and whether
those files have local changes. If a consulted file is modified or untracked, record its path and
capture the relevant diff or file hash; do not assume `HEAD` describes uncommitted content. For
Frontend synchronization, record the Backend contract version or commit as well.

## Documentation ownership

Do not update `CNPM-Docs` while working in Backend. If shared requirements, architecture, plans,
or decisions need a change, report the proposed change and the evidence so it can be applied in the
documentation repository by its owner.
