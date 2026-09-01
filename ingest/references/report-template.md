# Verdict Report Template

Render the report inline in the conversation. **Keep this structure, but write all prose in the language the user is speaking.** File paths, symbol names, and memory slugs stay untranslated. Use plain hyphens "-", never em-dashes. The ✓/✗ symbols are fine.

```markdown
# Requirement analysis: <short title>

**Source:** <pasted text / issue #123 / path/to/file.pdf / email from <sender role>>
**Date:** YYYY-MM-DD
**Tooling:** ariadne-code ✓/✗ | memory: personal ✓/✗, team ✓/✗ | spec workflow ✓/✗

## Summary

<2-3 sentences: how many requirements, how many SUPPORTED / PARTIAL / MISSING,
overall size of the gap, anything surprising.>

## Requirements overview

| # | Requirement | Verdict | Evidence | Gap estimate |
|---|-------------|---------|----------|--------------|
| R1 | ... | SUPPORTED | `src/module/service.ts:142` | - |
| R2 | ... | PARTIAL | `src/module/service.ts:88` + [[memory-slug]] | M (backend, admin) |
| R3 | ... | MISSING | - | L (backend, client, DB migration) |

## Details

<One section per PARTIAL or MISSING requirement. SUPPORTED requirements get
no detail section - the table row with evidence is enough.>

### R2: <requirement> - PARTIAL

**What exists:** <capability found, with `file:line` for each layer>
**What is missing:** <the concrete delta, per layer>
**Memory:** [[memory-slug]] - <why it is relevant, e.g. "notes the feature is disabled in production">
**Estimate:** M - affected modules: <list>

### R3: <requirement> - MISSING

**Where it would live:** <modules/layers that would host it, based on how neighboring capabilities are structured>
**Estimate:** L - affected modules: <list>

## Constraints and open questions

<Non-capability items from the source (deadlines, budget, SLAs), contradictions
between memory and code, and anything that needs the requester's clarification.>

## Next steps

1. Create a spec proposal for R3 (+ R2)? <only if a spec workflow was detected>
2. Persist these findings to memory? <ariadne remember / manual note>
3. <Bootstrap a memory system? - only if none was detected>
```

## Effort scale

| Grade | Meaning | Heuristic |
|---|---|---|
| S | up to half a day | one module, one layer touched, no schema change |
| M | 0.5-2 days | 2-3 modules or 2 layers (e.g. backend + admin UI), config or minor schema change |
| L | 2+ days | cross-module, new entity/migration, new external integration, or unclear blast radius |

- Always name the affected modules next to the grade - a bare letter is not an estimate.
- When ariadne-code is live, feed `impact_of` output into the grade: a wide dependent set pushes S -> M -> L.
- When two grades seem plausible, pick the larger one and say why.

## Rules

- Every SUPPORTED row cites at least one `file:line` you have Read this session.
- PARTIAL rows state the missing delta explicitly - "partially supported" alone is not a finding.
- Memory citations use the note's `[[slug]]` so the user can open it in their vault.
- Keep SUPPORTED rows to one line each; spend the detail budget on gaps.
