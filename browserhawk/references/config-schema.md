# BrowserHawk Configuration Schema

The `browserhawk.config.json` file lives in the project root and tells the browser agent how to interact with your application.

## Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `target` | string | Base URL of the application (e.g., `"https://localhost:3000"`) |
| `entryPoint` | string | Path to navigate to after authentication (e.g., `"/dashboard"`) |

## Auth Configuration

```json
"auth": {
  "type": "steps",
  "envFile": ".env.browserhawk",
  "steps": [...],
  "successIndicator": { "type": "url", "value": "/dashboard", "timeout": 30000 }
}
```

- `type`: `"steps"` (execute login steps) or `"none"` (no auth needed)
- `envFile`: Path to env file with credentials (default: `.env.browserhawk`)
- `successIndicator`: How to verify login succeeded — match URL substring or wait for CSS selector

### Auth Step Actions

| Action | Required Fields | Description |
|--------|----------------|-------------|
| `navigate` | `value` | Go to URL. Use `${target}` as placeholder for base URL |
| `click` | `selector` | Click an element |
| `fill` | `selector` + (`envVar` or `value`) | Fill an input. `envVar` reads from environment |
| `waitForUrl` | `pattern` | Wait for URL to match pattern (glob) |
| `waitForSelector` | `selector` | Wait for element to appear |
| `wait` | — | Wait for `timeout` ms (default 1000) |
| `pause` | `value` (optional message) | Print message, then wait for `successIndicator` (for manual auth / 2FA). Default timeout 120s |

All steps accept optional `timeout` (ms, default 10000) and `optional` (boolean — if true, failure doesn't abort login).

## Discovery Configuration

```json
"discovery": {
  "maxDepth": 3,
  "maxPages": 50,
  "excludePatterns": ["/auth/*", "/logout"],
  "sameDomainOnly": true
}
```

Controls how the agent crawls the application to discover routes.

## Bug Reporting

```json
"bugReporting": {
  "target": "conversation"
}
```

Options: `"conversation"` (report in chat), `"asana"`, `"github"`, `"linear"`.

## Known Routes

Optional pre-seeded routes to always test (in addition to discovered ones):

```json
"knownRoutes": [
  { "path": "/dashboard", "name": "Dashboard" },
  { "path": "/settings", "name": "Settings" }
]
```

## Health Check

Optional dev server verification:

```json
"healthCheck": {
  "command": "curl -sk https://localhost:3000 -o /dev/null -w '%{http_code}'",
  "expectedOutput": "200",
  "startCommand": "npm run dev"
}
```

## Auth Examples

### Simple Form Login
```json
"auth": {
  "type": "steps",
  "steps": [
    { "action": "navigate", "value": "${target}/login" },
    { "action": "fill", "selector": "#email", "envVar": "BROWSERHAWK_EMAIL" },
    { "action": "fill", "selector": "#password", "envVar": "BROWSERHAWK_PASSWORD" },
    { "action": "click", "selector": "button[type='submit']" }
  ],
  "successIndicator": { "type": "url", "value": "/dashboard" }
}
```

### OAuth/MSAL Redirect
```json
"auth": {
  "type": "steps",
  "steps": [
    { "action": "navigate", "value": "${target}" },
    { "action": "click", "selector": "button:has-text('Sign in with Microsoft')" },
    { "action": "waitForUrl", "pattern": "**/login.microsoftonline.com/**", "timeout": 15000 },
    { "action": "fill", "selector": "input[type='email']", "envVar": "BROWSERHAWK_EMAIL" },
    { "action": "click", "selector": "input[type='submit']" },
    { "action": "waitForSelector", "selector": "input[type='password']", "timeout": 10000 },
    { "action": "fill", "selector": "input[type='password']", "envVar": "BROWSERHAWK_PASSWORD" },
    { "action": "click", "selector": "input[type='submit']" },
    { "action": "click", "selector": "#idSIButton9", "optional": true, "timeout": 5000 }
  ],
  "successIndicator": { "type": "url", "value": "localhost:3000", "timeout": 60000 }
}
```

### No Auth (Public App)
```json
"auth": {
  "type": "none",
  "steps": [],
  "successIndicator": { "type": "url", "value": "localhost" }
}
```

## Storage Directory

The browser agent automatically creates a `.browserhawk/` directory in the project root for persistent data:

```
.browserhawk/
├── baselines/              # Visual regression baseline screenshots
│   ├── dashboard.png
│   └── accounts.png
├── reports/                # Test run reports (YYYY-MM-DD-<description>.md)
│   └── 2026-03-29-smoke-test.md
└── discovered-routes.json  # Accumulated discovered routes
```

This directory is created automatically. Depending on your workflow:

- **Commit baselines** if you want the team to share visual regression baselines
- **Gitignore baselines** if baselines vary by environment (different data, themes, etc.)
- **Commit discovered-routes.json** to share the route map across the team
- **Commit reports** to keep a history of test findings
