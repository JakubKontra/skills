# Memory Integration and Bootstrap

This skill integrates with an [ariadne](https://github.com/JakubKontra/ariadne)-style two-layer, Obsidian-compatible memory system. Everything here degrades gracefully when the project has no memory at all (Phase 3 becomes a no-op and Phase 6 offers bootstrap).

## The two layers

| Layer | Location | Contents |
|---|---|---|
| Personal | `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/<flattened-cwd>/memory/` (flatten cwd by replacing `/` and `.` with `-`) | Facts about the engineer, in-flight work state; machine-local, never committed |
| Team | `<repo>/docs/brain/` | Durable project facts (ADRs, incidents, domain knowledge); git-committed and PR-reviewed |

The personal layer's `MEMORY.md` is an auto-generated index (written by `ariadne index`). **Read it for recall; never edit it.**

## Note schema

One file, one fact:

```markdown
---
name: short-kebab-case-slug
description: one-line summary, used to decide relevance during recall
metadata:
  type: project | reference | architecture | incident | feedback
---

Lead with the fact or decision.

**Why:** the reasoning or trigger behind it.
**How to apply:** what a reader should do with it.

Link related notes with [[their-slug]].
```

- `name` is the slug other notes link to; it may differ from the filename.
- `description` is what recall greps - make it carry the searchable keywords.
- `feedback` type belongs only in the personal layer.

## Recall (Phase 3)

1. Read the personal `MEMORY.md` index if it exists - it is one file with every note's slug + description.
2. Grep team notes in one pass: `grep -r "^description:" docs/brain/*.md` (or read frontmatter of files whose names match requirement keywords).
3. Attach matches to requirements and cite them in the report as `[[slug]]`.

## Persistence (Phase 6, only after the user opts in)

With the ariadne CLI (`command -v ariadne`):

```bash
ariadne remember "<one-line fact worth keeping>"   # quick personal note
ariadne new <type> <name>                          # scaffold a fuller note
ariadne promote <file>                             # move a personal note to the team layer (git)
ariadne index                                      # regenerate MEMORY.md - the only legitimate writer of that file
```

Without ariadne: write the note file by hand following the schema above - team-worthy facts into `docs/brain/`, personal ones into the personal layer directory - and mention that the `MEMORY.md` index will need `ariadne index` (or the project's equivalent) to pick it up.

> **Warning - naming collision:** `ariadne ingest <source>` is a pre-existing, unrelated command (it converts raw documents from an Obsidian vault's `05-Raw/` folder into memory notes). This skill must never invoke it. Persistence uses the commands above only.

## Bootstrap (Phase 6, when no memory system was detected)

**With the ariadne CLI:** run `ariadne init` - it is interactive (shows its plan and asks y/N), so run it in a way the user sees and answers the prompt; never pipe "y" into it. Follow with `ariadne doctor` to confirm the setup.

**Without ariadne**, create the minimal manual structure - exactly two files, nothing more:

1. `docs/brain/README.md` - a condensed contract: what belongs here (durable project facts, decisions, incidents), what does not (secrets, personal notes, ephemeral state), and the note schema from this document.
2. A first note capturing this ingest run's findings (type `project`), so the memory starts useful rather than empty.

Do not bootstrap a vault, an MCP server, scheduled jobs, or a personal-layer directory - those are per-engineer choices that `ariadne init` handles when the user adopts the full tool.
