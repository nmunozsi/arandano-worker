---
id: T-architect
title: Refresh docs/architecture.md after plan {{plan_slug}}
role: architect
tdd: relaxed
depends_on: [{{depends_on_csv}}]
---

# Refresh docs/architecture.md

The plan `{{plan_slug}}` just merged the following commit range:

```
{{merge_range}}
```

Read the SKILL.md at `/opt/arandano/skills/architect/SKILL.md` and apply minimal edits to `docs/architecture.md` per its rules.

## Inputs

- Current arch doc: `docs/architecture.md`
- Plan: `{{plan_path}}`
- Diff: `git log {{merge_range}}` and `git diff {{merge_range}}`

## Acceptance

- `docs/architecture.md` has exactly one new entry appended to §5, dated `{{date}}`.
- §2/§3/§4/§6 are edited only as required by the SKILL's rules.
- One commit: `:memo: docs(arch): refresh after {{plan_slug}}`.
- If no architectural change applies, print `architect: no-op` and produce no commit.
