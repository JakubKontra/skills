# Codebase Verification Guide

## Tool ladder

Always use the highest rung available (detected in Phase 0). Lower rungs remain as complements - e.g. final evidence is always a Read, whatever found the file.

### Rung 1: ariadne-code MCP (semantic navigation)

Available when `mcp__ariadne-code__*` tools respond. Started in the project with `ariadne mcp` (some repos wrap it, e.g. an `ariadne:mcp` npm script).

| Tool | Use it to |
|---|---|
| `search_code` | Entry point per requirement - semantic search for the capability's keywords |
| `find_symbol` | Locate a class/function once you know its likely name |
| `outline_file` | Confirm what a candidate file actually contains before citing it |
| `find_dependencies` / `find_dependents` | Check the capability is connected to the rest of the system |
| `who_calls` / `callees` | Prove a code path is actually invoked (wiring proof for SUPPORTED) |
| `dead_code` | Guard against "exists but unused" - a dead implementation is PARTIAL, not SUPPORTED |
| `impact_of` | Blast radius of a change - feeds the effort estimate for gaps |
| `describe_schema` / `list_tables` | Verify the data-model layer for DB-backed requirements |

### Rung 2: ariadne configured, MCP down

`ariadne.config.json` exists at the repo root but the MCP tools are absent or failing. Tell the user once:

> ariadne-code MCP is configured but not running - start it with `ariadne mcp` and I can navigate the codebase faster. Continuing with the cached code map meanwhile.

Then use the committed cache:
- `.ariadne/code-map.md` - module-level routing map; read it first to decide where each requirement lives.
- `.ariadne/symbol-index.json` - grep it for symbol names to get candidate files.
- The cache may be stale relative to the working tree: it routes you, it is never evidence. Evidence comes from Reading the current file.

### Rung 3: no ariadne

- TypeScript/JavaScript projects with an LSP tool available: `workspaceSymbol`/`documentSymbol` to locate, `findReferences`/`incomingCalls` as wiring proof.
- Otherwise language-agnostic: Glob for module layout, Grep for capability keywords and route/endpoint strings, Read to verify.

### Rung 4: fan-out (any rung, many requirements)

For more than 5 requirements or an unfamiliar repo, launch parallel read-only Explore subagents, one per requirement cluster. Prompt template:

> Verify whether this codebase supports: "<requirement>". Search for the data model, business logic, and exposure surface (API route, UI, CLI) that would implement it. Read the files you cite. Return: verdict (SUPPORTED / PARTIAL / MISSING), evidence as file:line for each layer found, what is missing (for PARTIAL), and which modules a fix would touch. Read-only - do not modify anything.

Merge the agents' verdicts yourself and spot-check any SUPPORTED claim whose evidence looks thin.

## Verdict criteria

| Verdict | Bar to clear | Typical failure to watch for |
|---|---|---|
| SUPPORTED | End-to-end path: data model + business logic + exposure surface, each with file:line evidence, and memory does not contradict | Logic exists but nothing calls it (dead code); feature flag off in production per a memory note |
| PARTIAL | Some layers exist, or a neighboring capability could be extended/configured | Vague "partially" without naming the missing delta |
| MISSING | Honest search across plausible modules found nothing | Giving up after one grep term - try synonyms and the domain's naming conventions first |

Micro-examples:
- Requirement "users can export their data as CSV". Found an `ExportService` with a CSV serializer, a REST endpoint, and a UI button wired to it -> SUPPORTED with three citations. Found only the serializer, no endpoint -> PARTIAL ("serialization exists, no exposure surface; gap: endpoint + UI, estimate M").
- Requirement "system sends a weekly digest email". Found a digest template and a scheduler entry, but memory note [[digest-disabled]] says the cron was turned off after an incident -> PARTIAL, citing both code and memory.
- Requirement "real-time chat between users". No websocket layer, no message entity, nothing adjacent -> MISSING ("would live in a new backend module + a client feature; estimate L").

## Non-TypeScript projects

Nothing in this skill assumes TypeScript. Skip LSP-specific steps when no language server is available; the ariadne graph works wherever the project configured it; otherwise rung 3's Grep/Read path is fully language-agnostic. Layer names differ (e.g. templates instead of a SPA UI) - map "exposure surface" to whatever the project uses.
