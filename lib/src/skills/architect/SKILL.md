---
name: architect
description: Use when assigned the architect role. Updates docs/architecture.md to reflect the just-merged plan's changes. Minimal-diff edits only.
---

# Architect skill

You are running as the `architect` role. Your one job is to refresh `docs/architecture.md` so it reflects what the just-finished plan actually shipped.

## Inputs available to you

- `docs/architecture.md` — the current file.
- Plan files (path provided by the orchestrator): `<spec>/plans/<plan-slug>/{spec.md, plan.md, phase-*/phase.md, T*.md}`.
- Git history of the plan's merge range: `git log <base>..<head>` (the range is in env var `ARANDANO_PLAN_MERGE_RANGE`).

## The template (the doc has exactly these six sections)

| §   | Section        | What it owns                                   |
| --- | -------------- | ---------------------------------------------- |
| 1   | Overview       | One paragraph.                                 |
| 2   | Components     | Table: component, path, responsibility, stack. |
| 3   | Data flow      | One mermaid diagram.                           |
| 4   | Tech stack     | Bullets.                                       |
| 5   | Key decisions  | Append-only, dated, newest first.              |
| 6   | Open questions | Same format as §5. Removed when resolved.      |

## Rules

- **DO** append one entry to §5 dated today, summarizing the plan's net architectural change in 1–3 sentences. Use this format exactly:

  ```
  - **YYYY-MM-DD — D<n>: <short title>.** _Why:_ <reason>. _Trade-off:_ <trade>. _Owner:_ @<handle>.
  ```

  `<n>` is one greater than the highest existing `Dn` in §5. If the file has no entries yet, start at `D1`.

- **DO** edit §2 rows when a component's responsibility or path changed.

- **DO** add a new §2 row when the plan introduced a new package, executable, or first-class subsystem.

- **DO** edit the §3 diagram **only** when §2 changed (new component, removed component, or changed responsibility). The diagram lists nodes equal to §2 rows.

- **DO** edit §4 when the plan introduced a new language, runtime, build tool, test framework, CI system, or external service.

- **DO NOT** rewrite or reorder existing §5 entries.

- **DO NOT** delete a §2 row without also adding a §5 entry explaining the removal.

- **DO NOT** touch §3 when §2 didn't change.

- **DO NOT** touch §1 unless the project's purpose changed — typically you won't.

- **DO NOT** add a §6 entry unless the plan exposed a real open question.

## Worked examples

### Example A — plan added a new package

Plan: introduced `@arandano/executors-k8s` and a new `K8sExecutor` class.

Edit:

- §2: add `| K8s executor | packages/executors-k8s | Dispatch tasks to Kubernetes | TypeScript |`.
- §3: add `k8s[K8s executor]` node + `cli --> k8s`.
- §5: append `- **2026-05-20 — D7: Add K8s executor.** _Why:_ homelab readiness. _Trade-off:_ second executor to maintain. _Owner:_ @nmunozsi.`

### Example B — plan refactored internals only

Plan: extracted DAG validation into a separate file; no public API change.

Edit:

- §5: append `- **2026-05-21 — D8: Extract DAG validator.** _Why:_ readability. _Trade-off:_ none. _Owner:_ @nmunozsi.`
- §2/§3/§4/§6 untouched.

## When the diff is empty

If after applying the rules above your changes would not modify the file, **do not commit**. Print `architect: no-op` to stdout. The worker's `architect-driver` recognises this and skips PR creation.

## Commits

Every commit you make follows the gitmoji format from the `gitmoji-commits` skill. The only commits the architect should produce are:

- `:memo: docs(arch): refresh after <plan-slug>` — the single edit commit.
