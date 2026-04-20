# Vulniq JSON Schemas

JSON Schema (draft 2020-12) definitions for every data artefact Vulniq owns. These schemas are for external tooling (ajv, VS Code, IntelliJ, CI linters) — **Vulniq itself performs no runtime schema validation** because it is STDLIB-ONLY (APTS-TP-006 SBOM claim, zero npm dependencies).

These schemas describe the **current behaviour of Vulniq 1.3.0**. Any future breaking change bumps both the code version and the schemas together.

## What each schema validates

| Schema | Validates |
|---|---|
| `roe.schema.json` | `vulniq.roe.json` at the project root (see `assets/vulniq.roe.example.json`) |
| `config.schema.json` | `vulniq.config.json` at the project root (see `assets/config.example.json`) |
| `audit-log-entry.schema.json` | One NDJSON line in `.vulniq/audit-log.ndjson` |
| `apts-foundation.schema.json` | `references/apts-foundation.json` (APTS Foundation tier checklist) |
| `sarif-properties.schema.json` | The `properties` object on SARIF `results[]` entries (APTS D8 extension) |

## Validate with ajv-cli (no install required)

`ajv-cli` is a transient test-time tool, not a declared Vulniq dependency. `npx -y` fetches it on demand:

```bash
# Rules of Engagement
npx -y ajv-cli@5 validate -s vulniq/schemas/roe.schema.json -d vulniq.roe.json --strict=false

# Config
npx -y ajv-cli@5 validate -s vulniq/schemas/config.schema.json -d vulniq.config.json --strict=false

# A single audit-log line (extract first with head; ajv wants a single JSON object)
head -n 1 .vulniq/audit-log.ndjson \
  | npx -y ajv-cli@5 validate -s vulniq/schemas/audit-log-entry.schema.json -d /dev/stdin --strict=false

# APTS Foundation checklist
npx -y ajv-cli@5 validate -s vulniq/schemas/apts-foundation.schema.json -d vulniq/references/apts-foundation.json --strict=false

# SARIF result properties fragment (extract with jq from reports/*.sarif.json)
jq '.runs[0].results[0].properties' reports/security-audit.sarif.json \
  | npx -y ajv-cli@5 validate -s vulniq/schemas/sarif-properties.schema.json -d /dev/stdin --strict=false
```

`--strict=false` keeps ajv from tripping on JSON-Schema keywords it considers "strict" warnings; it does not disable validation of your data.

## VS Code automatic validation

Add to `.vscode/settings.json` (project) or user settings:

```json
{
  "json.schemas": [
    { "fileMatch": ["vulniq.roe.json"], "url": "./vulniq/schemas/roe.schema.json" },
    { "fileMatch": ["vulniq.config.json"], "url": "./vulniq/schemas/config.schema.json" }
  ]
}
```

The example files (`assets/vulniq.roe.example.json`, `assets/config.example.json`) also carry a `"$schema"` relative pointer as their first key, so editors validate them without any settings change.

## Audit-log validation (all lines)

`ajv-cli` validates a single document per invocation. To lint every line of an NDJSON file:

```bash
while IFS= read -r line; do
  printf '%s' "$line" \
    | npx -y ajv-cli@5 validate -s vulniq/schemas/audit-log-entry.schema.json -d /dev/stdin --strict=false \
    || break
done < .vulniq/audit-log.ndjson
```

For chain-integrity (prevHash/thisHash) verification use `node vulniq/scripts/cli.mjs audit-verify` — that is the authoritative check; the JSON schema only validates per-line shape.

## Notes

- **No runtime dependency.** Vulniq's scripts never call into ajv. These schemas are consumed by IDEs, CI, and external auditors.
- **Future breaking changes** will bump both Vulniq's package.json version and the corresponding schema. Open a PR that updates both together.
- **Draft version** is JSON Schema 2020-12 across the board — do not downgrade to draft-07 or draft-04.
