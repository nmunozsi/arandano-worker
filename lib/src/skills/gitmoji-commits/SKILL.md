---
name: gitmoji-commits
description: Use whenever creating a Git commit in this repository. Every commit subject MUST start with one of the 16 curated gitmoji shortcodes followed by a Conventional Commits header.
---

# Gitmoji on top of Conventional Commits

Every commit subject MUST match exactly this shape:

```
:emoji: type(scope): subject
```

Where `:emoji:` is one of the 16 curated shortcodes below, and `type` is the Conventional Commits type that pairs with it. Commitlint will reject any commit that doesn't match.

## The 16 allowed emoji shortcodes

| Shortcode               | Type     | Use for                          |
| ----------------------- | -------- | -------------------------------- |
| `:sparkles:`            | feat     | New feature for the user         |
| `:bug:`                 | fix      | User-visible bug fix             |
| `:ambulance:`           | fix      | Critical hotfix                  |
| `:lock:`                | fix      | Security-impacting fix           |
| `:zap:`                 | perf     | Performance improvement          |
| `:recycle:`             | refactor | Refactor with no behavior change |
| `:fire:`                | refactor | Remove code/files                |
| `:white_check_mark:`    | test     | Add or update tests              |
| `:memo:`                | docs     | Docs only                        |
| `:art:`                 | style    | Formatting, whitespace, no logic |
| `:rotating_light:`      | style    | Fix linter warnings              |
| `:wrench:`              | chore    | Config / tooling                 |
| `:construction_worker:` | ci       | CI changes                       |
| `:arrow_up:`            | chore    | Upgrade dependencies             |
| `:arrow_down:`          | chore    | Downgrade dependencies           |
| `:bookmark:`            | chore    | Release / version tag            |

## Worked examples

```
:sparkles: feat(cli): add --with-architect flag
:bug: fix(executors-docker): inject git safe.directory env vars
:white_check_mark: test(core): cover DAG cycle detection
:memo: docs(plans): mark Task 3 complete
:wrench: chore(deps): bump dockerode to 4.0.4
:fire: refactor(templates): remove legacy tasks/ scaffold
```

## Rules

- Use the SHORTCODE form (`:sparkles:`), not the unicode glyph (`✨`).
- The emoji and the type MUST match the table. `:sparkles: fix(…)` is rejected.
- Merge commits (subject starts with `Merge `) are exempt — commitlint's `ignores` array skips them.
- TDD commits during a task: the failing-test commit uses `:white_check_mark: test(scope): …`; the implementation commit uses `:sparkles: feat(scope): …` or `:bug: fix(scope): …` as appropriate; the refactor uses `:recycle: refactor(scope): …`.

## When in doubt

Pick the closest single category. Don't invent new types. Don't combine emojis. If the change spans categories, split it into two commits.
