# RankPulse Configuration Schema

Configuration file: `rankpulse.config.json` in the project root. **All fields are optional** — RankPulse works with zero config and auto-detects what it can.

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `domain` | string | `null` | The domain to query in Ahrefs and GSC (e.g., `example.com`). Auto-detected from `package.json` homepage or config if not set. |
| `checks` | object | all enabled | Enable/disable individual check categories |
| `checks.<name>.enabled` | boolean | `true` | Whether to run this check |
| `checks.<name>.severity` | string | varies | Override default severity for this category |
| `competitors` | string[] | `[]` | Competitor domains for comparison (used in Ahrefs analysis) |
| `exclude` | string[] | see below | Glob patterns for files to skip in codebase audit |
| `include` | string[] | `[]` | If non-empty, **only** scan matching files |
| `severityThreshold` | string | `"low"` | Minimum severity to include in report |
| `maxFindings` | number | `300` | Stop reporting after this many findings |
| `reportTitle` | string | `"SEO Health Check"` | Custom title for the report |

## Check Categories

| Key | Default Severity | Type | Description |
|-----|-----------------|------|-------------|
| `gsc` | — | External | Google Search Console data: crawl errors, indexing, performance |
| `ahrefs` | — | External | Ahrefs data: DR, backlinks, keywords, site audit |
| `meta` | high | Code | Page titles, descriptions, Open Graph, Twitter Cards |
| `robots` | critical | Code | robots.txt rules, meta robots tags |
| `sitemap` | high | Code | Sitemap presence, validity, dynamic generation |
| `canonical` | high | Code | Canonical tags, trailing slash consistency |
| `schema` | medium | Code | JSON-LD structured data |
| `headings` | medium | Code | H1 presence and uniqueness |
| `images` | medium | Code | Alt text coverage, dimensions, lazy loading |
| `links` | medium | Code | Internal link structure, broken links |
| `i18n` | medium | Code | Hreflang tags, language attributes (disabled by default) |
| `performance` | medium | Code | Render-blocking resources, image optimization |

**External checks** (`gsc`, `ahrefs`) require the corresponding MCP server to be connected. If unavailable, the check is skipped with a note in the report. **Code checks** use Claude's built-in tools (Grep, Read, Glob) and always work.

## Default Exclude Patterns

```json
[
  "node_modules/**",
  ".git/**",
  "dist/**",
  "build/**",
  ".next/**",
  ".nuxt/**",
  "coverage/**",
  "*.min.js",
  "*.bundle.js",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml"
]
```

## Competitor Analysis

When `competitors` is set and Ahrefs is available, the report includes a comparison section:

```json
{
  "competitors": ["competitor1.com", "competitor2.com"]
}
```

Comparison includes: Domain Rating, organic traffic, referring domains, keyword overlap.

## Storage Directories

| Directory | Purpose |
|-----------|---------|
| `.rankpulse/` | Internal state (scan history, baselines) — do NOT commit |
| `.rankpulse/baselines/` | Metric snapshots for trend tracking |
| `./reports/` | Generated scan reports (committable) |
