# Agent Skills

A collection of agent skills that extend capabilities across planning, development, and tooling.

## Installation

Install any skill from this repo using the [`skills`](https://skills.sh) CLI:

```bash
# Install BrowserHawk
npx skills add JakubKontra/skills --skill browserhawk

# List all available skills
npx skills add JakubKontra/skills --list

# Install all skills
npx skills add JakubKontra/skills --skill '*'
```

## Skills

### [Vulniq](docs/vulniq.md)

Autonomous security vulnerability scanner for codebases. Detects secrets, XSS, missing security headers, auth issues, OWASP Top 10 patterns, dependency vulnerabilities, and more. Outputs SARIF JSON + human-readable MD reports.

```mermaid
flowchart LR
    A["/vulniq"] --> B["Load Config"]
    B --> C["Detect Project"]
    C --> D["Scan & Analyze"]
    D --> E["Score & Grade"]
    E --> F["SARIF + Report"]

    style A fill:#7c3aed,color:#fff
    style F fill:#dc2626,color:#fff
```

**Features:**
- Zero config required — works out of the box on any JS/TS project
- 10 security categories: secrets, XSS, headers, PII, auth, deps, OWASP, CORS, errors, supply chain
- Hybrid engine: Claude code analysis + npm audit + git history scanning
- Context-aware verification — reads surrounding code to reduce false positives
- SARIF 2.1.0 output for GitHub Code Scanning, VS Code, and other tooling
- Suppressions, scan history, and custom detection patterns

**Quick start:**
```bash
# Install the skill
npx skills add JakubKontra/skills --skill vulniq

# Run in Claude Code — no config needed
/vulniq

# Optional: create config for customization
cp .claude/skills/vulniq/assets/config.example.json vulniq.config.json
```

[Full documentation](docs/vulniq.md)

---

### [BrowserHawk](docs/browserhawk.md)

Autonomous browser testing agent for any web application. Discovers routes, tests pages, fills forms, finds bugs, and learns from every session via a journey-based memory system.

```mermaid
flowchart LR
    A["/browserhawk"] --> B["Authenticate"]
    B --> C["Discover Routes"]
    C --> D["Test & Explore"]
    D --> E["Save Journeys"]
    E --> F["Report Bugs"]

    style A fill:#7c3aed,color:#fff
    style F fill:#dc2626,color:#fff
```

**Features:**
- Works with any web app via a single config file (`browserhawk.config.json`)
- Uses [agent-browser](https://github.com/nichochar/agent-browser) (fast Rust daemon) for browser automation
- Learns successful interaction patterns as **journeys** — each run gets smarter
- Visual regression testing with baseline screenshots
- Supports form login, OAuth/MSAL, 2FA, or no auth
- Bug reporting to conversation, GitHub issues, or Asana

**Quick start:**
```bash
# Install the skill
npx skills add JakubKontra/skills --skill browserhawk

# Install agent-browser
npm install -g agent-browser && agent-browser install

# Create config in your project root
cp .claude/skills/browserhawk/assets/config.example.json browserhawk.config.json
# Edit browserhawk.config.json with your app's details

# Run in Claude Code
/browserhawk
```

[Full documentation](docs/browserhawk.md)

## License

[MIT](LICENSE)
