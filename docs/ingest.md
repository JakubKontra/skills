# Ingest

Feed it a requirement - a feature request, a GitHub issue, a PDF spec, or a pasted email - and it tells you what your system **already supports**, what exists **partially**, and what is **missing entirely**, with file:line evidence for every claim.

## What it Does

Ingest runs a gap analysis pipeline:

1. **Normalize** the input (plain text, `#123` issue via `gh`, file path, PDF, pasted email)
2. **Extract** discrete, verifiable capability requirements (one capability per item)
3. **Recall** project memory first - notes like "disabled in production" often flip a verdict before any code is read
4. **Verify** each requirement against the codebase, choosing the best available navigation tool
5. **Report** a verdict per requirement: `SUPPORTED / PARTIAL / MISSING`, each backed by `file:line` evidence and memory citations, with an S/M/L effort estimate for every gap
6. **Offer follow-ups** - a spec proposal for the gaps, persisting findings to memory, or bootstrapping a memory system on projects that have none

```mermaid
flowchart LR
    A["/ingest"] --> B["Detect\naffordances"]
    B --> C["Normalize\ninput"]
    C --> D["Extract\nrequirements"]
    D --> E["Memory\nrecall"]
    E --> F["Codebase\nverification"]
    F --> G["Verdict report\n+ follow-ups"]

    style A fill:#7c3aed,color:#fff
    style G fill:#059669,color:#fff
```

## Installation

```bash
npx skills add JakubKontra/skills --skill ingest
```

## Quick Start

```bash
# Paste a requirement
/ingest Can we let customers export their order history as CSV?

# Assess a GitHub issue
/ingest #482

# Assess a spec document
/ingest ./specs/client-rfp.pdf
```

## Integrations (all optional)

Ingest detects what the project offers and uses the best available rung - it never fails on a missing integration:

| Setup | What You Get |
|-------|-------------|
| Bare project (nothing installed) | Language-agnostic analysis via grep/read + parallel explore agents |
| + LSP | Symbol-accurate navigation for typed codebases |
| + [ariadne](https://github.com/JakubKontra/ariadne) CLI | Findings persisted as memory notes (`ariadne remember`), memory bootstrap (`ariadne init`) |
| + ariadne-code MCP server | Semantic code navigation: `search_code`, `who_calls`, `impact_of`, `dead_code` - wiring proof and blast-radius-based estimates |
| + project memory (personal + team notes) | Verdicts informed by decisions, incidents, and deployment state the code cannot show |
| + OpenSpec | One-step handoff from a MISSING verdict to a spec proposal |
| + `gh` CLI | Issue numbers and URLs as direct input |

## The Verdicts

- **SUPPORTED** - an end-to-end path exists (data model + business logic + exposure surface), evidenced at every layer, and memory does not contradict it. Dead code does not count.
- **PARTIAL** - some layers exist or a neighboring capability could be extended; the report states the exact missing delta.
- **MISSING** - an honest search found nothing; the report says where the capability would live and what it would touch.

Every gap gets an effort grade: **S** (up to half a day), **M** (0.5-2 days), **L** (2+ days or cross-module), with affected modules named.

## Memory Bootstrap

On a project with no memory system, Ingest offers to initialize one - `ariadne init` when the CLI is present, otherwise a minimal two-file structure (`docs/brain/README.md` with the note schema + a first note capturing the analysis findings). Nothing is ever created without you opting in.
