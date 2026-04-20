# Temp Email

Disposable email inboxes on demand. Temp Email creates throwaway addresses via the **tempmail.lol** API for E2E testing, account registration, email verification flows, and OTP confirmation. No dependencies, no API key — just `curl`.

## What it Does

1. Creates a disposable email inbox with a random address
2. Polls for incoming messages (configurable interval and timeout)
3. Extracts verification links, OTP codes, and magic links from received emails
4. Persists inbox state locally so you can manage multiple inboxes across a session

```mermaid
flowchart LR
    A["/create-temporary-mail"] --> B["Create Inbox"]
    B --> C["Share Address"]
    C --> D["Poll for Email"]
    D --> E["Extract Link/OTP"]

    style A fill:#7c3aed,color:#fff
    style E fill:#059669,color:#fff
```

## Installation

```bash
npx skills add JakubKontra/skills --skill temp-email
```

## Quick Start

```bash
# Run in Claude Code — no config needed
/create-temporary-mail

# Optional: create config for custom poll timing
cp .claude/skills/temp-email/assets/config.example.json temp-email.config.json
```

## Features

- **Zero config** — works immediately, no API key needed
- **Domain rotation** — tempmail.lol rotates domains automatically, reducing blocklist risk
- **Smart extraction** — parses HTML emails for verification URLs, OTP codes, magic links
- **Multi-inbox support** — label and manage multiple inboxes for complex flows (invite testing, multi-user scenarios)
- **Configurable polling** — adjust interval and timeout to match your workflow
- **Local persistence** — inboxes stored in `.temp-email/inboxes.json` for session continuity

## Use Cases

| Scenario | How |
|----------|-----|
| **E2E signup test** | Create inbox, register with address, poll for verification email, extract link |
| **OTP verification** | Create inbox, trigger OTP send, poll for code, extract 4-8 digit number |
| **Invite flow testing** | Create 2+ inboxes (inviter, invitee), send invite, check invitee inbox |
| **Password reset test** | Create inbox, trigger reset, extract reset link from email |
| **Newsletter signup** | Create inbox, subscribe, verify the confirmation email arrives |

## Configuration

All config is optional. Create `temp-email.config.json` in your project root:

```json
{
  "pollInterval": 5,
  "pollTimeout": 60,
  "autoCleanup": true
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `pollInterval` | 5 | Seconds between message checks |
| `pollTimeout` | 60 | Max seconds to wait for a message |
| `autoCleanup` | true | Remove expired inboxes from storage on list |

## API Reference

Temp Email uses the [tempmail.lol](https://tempmail.lol) v2 API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v2/inbox/create` | POST | Create a new inbox, returns `{address, token}` |
| `/v2/inbox?token=TOKEN` | GET | Check messages, returns `{emails: [...], expired: bool}` |

No authentication required. Inboxes expire after ~10 minutes of inactivity.

## Limitations

- Inboxes expire after ~10 minutes — not suitable for long-lived addresses
- Some services block known disposable email domains
- HTML-only email parsing (no plain-text fallback from the API)
- No outbound email — receive only
