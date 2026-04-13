# RankPulse

Your guide through the treacherous terrain of search engine rankings. RankPulse is an autonomous SEO diagnostics skill that combines **Google Search Console**, **Ahrefs**, and **codebase analysis** into a single comprehensive technical SEO health report.

## What it Does

RankPulse pulls data from three sources and cross-references them to find the real problems:

1. **Google Search Console** (via MCP) — crawl errors, indexing issues, search performance, Core Web Vitals
2. **Ahrefs** (via MCP) — domain rating, backlink profile, keyword rankings, competitor analysis, site audit issues
3. **Codebase** — meta tags, robots.txt, sitemap, canonical tags, structured data, heading hierarchy, image alt text, internal links

The magic is in the cross-referencing. A GSC "Soft 404" error becomes actionable when RankPulse traces it to a page template that returns 200 status with "not found" messaging. A missing canonical tag in code becomes urgent when GSC already reports "Duplicate without user-selected canonical."

```mermaid
flowchart LR
    A["/rankpulse"] --> B["Load Config"]
    B --> C["Detect Project"]
    C --> D["GSC + Ahrefs Data"]
    D --> E["Codebase Audit"]
    E --> F["Cross-Reference"]
    F --> G["Score & Report"]

    style A fill:#7c3aed,color:#fff
    style G fill:#059669,color:#fff
```

## Installation

```bash
npx skills add JakubKontra/skills --skill rankpulse
```

## Quick Start

```bash
# Run in Claude Code — no config needed for code-only audit
/rankpulse

# Optional: create config for full features
cp .claude/skills/rankpulse/assets/config.example.json rankpulse.config.json
# Edit with your domain and competitors
```

## MCP Integrations

RankPulse works with **any combination** of data sources:

| Setup | What You Get |
|-------|-------------|
| Code only (no MCP) | Full codebase SEO audit — meta tags, robots.txt, sitemap, canonicals, schema, headings, images, links |
| + GSC MCP | Adds crawl errors, indexing status, search performance, cross-referenced with code |
| + Ahrefs MCP | Adds domain rating, backlinks, keywords, traffic trends, competitor comparison |
| Both MCPs | Full picture — external data + code analysis + cross-referencing |

## Features

- **32 GSC error types** mapped with explanations, causes, and code-level fixes
- **12 code check categories**: meta, robots, sitemap, canonical, schema, headings, images, links, i18n, performance
- **Framework-aware**: understands Next.js, Nuxt, Gatsby, Astro, SvelteKit, Remix SEO patterns
- **Cross-referencing engine**: maps GSC symptoms to code causes
- **Competitor comparison**: compare DR, traffic, keywords against competitors (Ahrefs required)
- **Trend tracking**: baselines save metric snapshots between scans for progress monitoring
- **Scored & graded**: A-F grading system with per-category scores
- **Actionable reports**: every finding has a "how to fix" with code references

## Configuration

All config is optional. See [config schema](../rankpulse/references/config-schema.md) for full details.

```json
{
  "domain": "example.com",
  "competitors": ["competitor1.com"],
  "checks": {
    "gsc": { "enabled": true },
    "ahrefs": { "enabled": true },
    "meta": { "enabled": true },
    "i18n": { "enabled": false }
  }
}
```

## Report Output

Reports are saved to `./reports/` as timestamped Markdown files. They include:

- Executive summary
- SEO score with per-category breakdown
- Key metrics and trends (with Ahrefs)
- Showstoppers (critical issues)
- All findings grouped by severity
- Quick wins section
- Prioritized remediation roadmap
- Competitor comparison table
- Scan metadata

## GSC Errors Database

RankPulse includes a comprehensive database of 32 Google Search Console error types across 7 categories:

1. **Server & Access Errors** (9 errors) — 5xx, DNS, connectivity, 401, 403, other 4xx
2. **Redirects** (2 errors) — redirect errors, page with redirect
3. **Not Found** (4 errors) — 404, submitted 404, soft 404
4. **Blocked Pages** (7 errors) — robots.txt, noindex, page removal tool
5. **Crawl Status** (3 errors) — crawled not indexed, discovered not indexed
6. **Canonicals & Duplicates** (4 errors) — canonical mismatches, duplicates
7. **Content Issues** (3 errors) — indexed without content, legal removals

Each error includes: what it means, where to find it in GSC, why it matters, how to fix it, and what to check in the code.
