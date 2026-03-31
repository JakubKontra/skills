# Vulniq Security Detection Patterns

Reference document for all detection rules, organized by category. Each rule specifies grep patterns, file targets, verification steps, and severity classification.

---

## 1. SEC — Secrets & Environment Files

### SEC-001: Hardcoded API Keys/Tokens
**Grep patterns** (run against `*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.json`, `*.yaml`, `*.yml`, `*.env*`):
```
(api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|bearer)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{16,}['"]
```
**Exclude**: `*.test.*`, `*.spec.*`, `*.example.*`, `*.sample.*`, `*.md`
**Verify**: Read surrounding context — is this a placeholder, example value, or real credential?
**Severity**: Critical if real key, Info if placeholder

### SEC-002: AWS Credentials
```
AKIA[0-9A-Z]{16}
aws[_-]?secret[_-]?access[_-]?key\s*[:=]\s*['"][^'"]{20,}['"]
```
**Severity**: Critical

### SEC-003: Private Keys
```
-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----
```
**File types**: `*` (all files)
**Severity**: Critical

### SEC-004: Generic Secrets in Variables
```
(password|passwd|secret|token|credential|private[_-]?key)\s*[:=]\s*['"][^'"]{8,}['"]
```
**Verify**: Check if it's a type definition, interface, or enum (not a real value)
**Severity**: High (unless confirmed as type definition → skip)

### SEC-005: Connection Strings with Credentials
```
(mongodb|postgres|mysql|redis|amqp):\/\/[^:]+:[^@]+@
```
**Severity**: Critical

### SEC-006: Hardcoded JWT Tokens
```
eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.?[A-Za-z0-9_-]*
```
**Verify**: Confirm it's not in a test fixture or documentation
**Severity**: High

### SEC-007: Environment Files in Git
**Check**: Run `git ls-files '*.env*' '*/.env*'` and `git log --all --diff-filter=A --name-only -- '*.env*' '*.pem' '*.key'`
**Also check**: `.gitignore` for patterns like `.env`, `.env.*`, `.env.local`
**Severity**: Critical if production env files are tracked. High if any env files with real values are tracked.

### SEC-008: NEXT_PUBLIC Variables with Secrets
**Grep**: `NEXT_PUBLIC_.*(?:SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL)` in `*.env*` files
**Note**: NEXT_PUBLIC_ variables are exposed to the browser. API keys here are public.
**Severity**: High if it's a secret that shouldn't be client-side. Medium for API keys that are meant to be public but shouldn't be in git.

---

## 2. XSS — Cross-Site Scripting

### XSS-001: dangerouslySetInnerHTML
```
dangerouslySetInnerHTML
```
**File types**: `*.tsx`, `*.jsx`
**Verify**: Read 20 lines of context. Check if the value passed to `__html` is:
- Sanitized via DOMPurify, sanitize-html, xss, or isomorphic-dompurify → Medium
- A translation string from i18n → Low
- Raw API data or user input → Critical
- A hardcoded string → Info (skip)
**Severity**: Varies by context (see above)

### XSS-002: eval and Dynamic Code Execution
```
\beval\s*\(
\bnew\s+Function\s*\(
```
**Verify**: Is the argument a literal string or dynamic?
**Severity**: Critical if dynamic input, Medium if literal

### XSS-003: setTimeout/setInterval with Strings
```
\bsetTimeout\s*\(\s*['"`]
\bsetInterval\s*\(\s*['"`]
```
**Note**: String arguments to setTimeout/setInterval are evaluated as code
**Severity**: Medium

### XSS-004: DOM Manipulation
```
\.innerHTML\s*=
\.outerHTML\s*=
document\.write\s*\(
\.insertAdjacentHTML\s*\(
```
**Verify**: Check if the assigned value contains user input
**Severity**: High if dynamic, Low if static

### XSS-005: URL-based Injection
```
href\s*=\s*\{.*(?:user|param|query|input|data)
window\.location\s*=\s*(?!['"])
```
**Check for**: `javascript:` protocol in dynamic URLs
**Severity**: High

---

## 3. HDR — Security Headers

### HDR-001: Missing Content-Security-Policy
**Check these files**: `next.config.*`, `vercel.json`, `netlify.toml`, `**/middleware.*`, `server.*`, `app.*`
**Search for**: `Content-Security-Policy`, `contentSecurityPolicy`, `CSP`
**Also check**: `<meta http-equiv="Content-Security-Policy"` in HTML/layout files
**Finding**: If no CSP is configured anywhere
**Severity**: High

### HDR-002: Missing Strict-Transport-Security (HSTS)
**Search for**: `Strict-Transport-Security`, `strictTransportSecurity`, `hsts`
**Severity**: High

### HDR-003: Missing X-Frame-Options
**Search for**: `X-Frame-Options`, `xFrameOptions`, `frame-ancestors` (in CSP)
**Severity**: Medium

### HDR-004: Missing X-Content-Type-Options
**Search for**: `X-Content-Type-Options`, `nosniff`
**Severity**: Medium

### HDR-005: Missing Referrer-Policy
**Search for**: `Referrer-Policy`, `referrerPolicy`
**Severity**: Medium

### HDR-006: Missing Permissions-Policy
**Search for**: `Permissions-Policy`, `permissionsPolicy`, `Feature-Policy`
**Severity**: Low

### HDR-007: Helmet Not Configured (Express/Node)
**Check**: If project uses Express (grep for `express()`), check for `helmet` import/usage
**Severity**: Medium if Express app without helmet

---

## 4. PII — PII Exposure in Logging

### PII-001: Sentry Without beforeSend PII Scrubbing
**Files**: `sentry.client.config.*`, `sentry.server.config.*`, `sentry.edge.config.*`, `instrumentation-client.*`, `instrumentation.*`
**Check**: Read Sentry init config. Look for `beforeSend` or `beforeBreadcrumb` hooks.
**Finding**: No `beforeSend` hook that filters PII
**Severity**: High

### PII-002: Sentry sendDefaultPii Enabled
**Grep**: `sendDefaultPii\s*:\s*true`
**Severity**: High

### PII-003: Sentry Replay Capturing All Sessions in Production
**Check**: Read Sentry config and environment files for `replaysSessionSampleRate` and `replaysOnErrorSampleRate`
**Finding**: 100% session replay rate in production environment config
**Severity**: High (replays can capture form input, PII)

### PII-004: Sentry Replay Without Input Masking
**Check**: Look for `maskAllInputs: true`, `maskAllText: true`, or `blockAllMedia: true` in Replay config
**Finding**: Replay enabled without masking
**Severity**: Medium

### PII-005: Console Logging Sensitive Data
```
console\.(log|error|warn|debug|info)\s*\(.*(?:password|token|secret|credential|ssn|sin|credit.?card|social.?security)
```
**Also check**: Does the build config strip console.log in production? (e.g., Next.js `removeConsole`)
**Severity**: High if console statements survive production build, Medium if stripped

### PII-006: Logging User Objects
```
console\.(log|error|warn)\s*\(.*(?:user|profile|account|customer)\b
(logger|log)\.(error|warn|info)\s*\(.*(?:user|profile|account|customer)\b
```
**Verify**: Read context — is it logging a user ID (ok) or full user object with PII (bad)?
**Severity**: Medium

---

## 5. AUTH — Authentication Patterns

### AUTH-001: Tokens in localStorage
```
localStorage\.(setItem|getItem)\s*\(.*(?:token|auth|session|jwt|key|msal)
cacheLocation\s*:\s*['"]localStorage['"]
```
**Note**: MSAL with `cacheLocation: "localStorage"` is common but vulnerable to XSS
**Severity**: High

### AUTH-002: Missing Server-Side Route Protection
**Check**: Read Next.js middleware (`middleware.ts`/`middleware.js`). Does it check authentication?
**Check**: Are API routes protected by auth middleware?
**Finding**: Middleware only handles i18n/routing, not auth
**Severity**: High

### AUTH-003: Client-Side Only Auth Redirects
**Check**: Look for auth checks that only redirect via `useEffect` or client-side router
```
useEffect.*(?:isAuthenticated|isLoggedIn|session).*(?:router\.push|redirect|navigate)
```
**Finding**: Auth enforced only client-side without server middleware
**Severity**: Medium

### AUTH-004: Missing CSRF Protection
**Check**: For state-mutating API routes (POST, PUT, DELETE), look for CSRF token validation
**Search for**: `csrf`, `csurf`, `xsrf`, `csrfToken`
**Finding**: No CSRF protection found for forms/API routes
**Severity**: Medium

### AUTH-005: Insecure Cookie Configuration
```
cookie.*httpOnly\s*:\s*false
cookie.*secure\s*:\s*false
cookie.*sameSite\s*:\s*['"]none['"]
```
**Severity**: High for `httpOnly: false` on auth cookies, Medium for `secure: false`

---

## 6. DEP — Dependency Vulnerabilities

### DEP-001: npm/yarn Audit Vulnerabilities
**Command**: Run `npm audit --json 2>/dev/null` or detect package manager and use appropriate command
**Parse**: Map npm severity to Vulniq severity:
- `critical` → critical
- `high` → high
- `moderate` → medium
- `low` → low

**For each vulnerability, extract**: package name, severity, vulnerable version range, advisory URL, dependency path

### DEP-002: Audit Disabled
```
audit\s*=\s*false
```
**File**: `.npmrc`
**Severity**: Medium

---

## 7. OWA — OWASP Top 10 Patterns

### OWA-001: SQL Injection (A03)
```
(query|execute|raw)\s*\(\s*`.*\$\{
(query|execute)\s*\(\s*['"].*\+\s*
```
**File types**: `*.ts`, `*.js`
**Verify**: Is this using a parameterized query or ORM? Check for Prisma, TypeORM, Knex query builders.
**Severity**: Critical if raw SQL with string interpolation

### OWA-002: NoSQL Injection (A03)
```
\$where
\$regex.*(?:req\.|params\.|query\.|body\.)
```
**Severity**: High

### OWA-003: Command Injection (A03)
```
\bexec\s*\(.*(?:req\.|params\.|query\.|body\.|user)
\bspawn\s*\(.*(?:req\.|params\.|query\.|body\.|user)
\bexecSync\s*\(.*(?:req\.|params\.|query\.|body\.|user)
child_process.*(?:req\.|params\.|query\.|body\.)
```
**Severity**: Critical

### OWA-004: Path Traversal (A01)
```
path\.join\s*\(.*(?:req\.|params\.|query\.|body\.)
path\.resolve\s*\(.*(?:req\.|params\.|query\.|body\.)
fs\.(read|write|access|stat).*(?:req\.|params\.|query\.|body\.)
```
**Verify**: Is path validated/sanitized?
**Severity**: High

### OWA-005: Open Redirect (A01)
```
(?:redirect|location)\s*[\(=].*(?:req\.query|req\.params|searchParams|url\.searchParams)
```
**Verify**: Is there a URL allowlist?
**Severity**: Medium

### OWA-006: Weak Cryptography (A02)
```
createHash\s*\(\s*['"](?:md5|sha1)['"]
\bmd5\s*\(
\bsha1\s*\(
```
**Severity**: Medium (High if used for passwords or signatures)

### OWA-007: HTTP for Sensitive Operations (A02)
```
http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)
```
**File types**: `*.ts`, `*.js`, `*.env*`
**Verify**: Is this a non-sensitive resource (CDN for images) or API/auth endpoint?
**Severity**: High if API base URL, Medium otherwise

### OWA-008: Debug Mode in Production (A05)
```
DEBUG\s*[:=]\s*['"]?\*
debug\s*:\s*true
NODE_ENV\s*[:=]\s*['"]?development
```
**File**: Production config files only
**Severity**: Medium

### OWA-009: Missing Subresource Integrity (A08)
**Check**: `<script src=` and `<link href=` tags for external resources without `integrity` attribute
**File types**: `*.html`, `*.tsx`, `*.jsx`
**Severity**: Low

---

## 8. COR — CORS Configuration

### COR-001: Wildcard CORS Origin
```
Access-Control-Allow-Origin.*\*
cors\(\s*\)
origin\s*:\s*['"]?\*['"]?
AllowAnyOrigin
```
**Severity**: High

### COR-002: Reflective CORS Origin
```
origin\s*:\s*true
origin\s*:\s*(?:req\.headers\.origin|request\.headers\.origin)
```
**Verify**: Is origin validated against an allowlist before reflection?
**Severity**: High if no validation, Medium with partial validation

### COR-003: Credentials with Wildcard
**Check**: Is `Access-Control-Allow-Credentials: true` combined with wildcard origin?
```
AllowCredentials.*AllowAnyOrigin|AllowAnyOrigin.*AllowCredentials
credentials\s*:\s*true
```
**Severity**: Critical if combined with wildcard origin

### COR-004: Overly Broad Allowlist
**Read CORS config** and check if the allowed origins list includes wildcards or broad domains
**Severity**: Medium

---

## 9. ERR — Error Handling

### ERR-001: Stack Traces in API Responses
```
(res|response)\.(json|send|status)\s*\(.*(?:\.stack|stackTrace|err\.message|error\.message)
catch\s*\([^)]*\)\s*\{[^}]*res\.(json|send)\([^)]*(?:err|error)\s*\)
```
**Severity**: High

### ERR-002: Unfiltered Error Objects in Responses
```
res\.(?:json|send)\s*\(\s*(?:err|error)\s*\)
next\s*\(\s*(?:err|error)\s*\)
```
**Verify**: Is there a global error handler that strips stack traces?
**Severity**: Medium

### ERR-003: Missing Global Error Handler
**Check**: For Express apps — look for `app.use((err, req, res, next)` error middleware
**Check**: For Next.js — look for `error.tsx`/`error.js` boundary components and `app/global-error.tsx`
**Finding**: No global error boundary or handler
**Severity**: Medium

### ERR-004: Verbose Errors Without Environment Check
```
(?:err|error)\.(stack|message)(?!.*(?:NODE_ENV|production|development))
```
**Context**: Check if errors are conditionally detailed based on environment
**Severity**: Low

---

## 10. CHN — Dependency Chain

### CHN-001: Missing Lock File
**Check**: Does `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml` exist?
**Severity**: High

### CHN-002: Deprecated Packages
**Command**: `npm outdated --json 2>/dev/null` (or yarn equivalent)
**Flag**: Packages more than 2 major versions behind, or known-deprecated packages
**Severity**: Medium

### CHN-003: Suspicious postinstall Scripts
**Check**: Read `node_modules/.package-lock.json` or scan `package.json` files in `node_modules/` for `postinstall`, `preinstall`, `install` scripts
**Note**: This is informational — flag for manual review
**Severity**: Low

### CHN-004: Untrusted Dependency Sources
```
"file:"
"git\+https?://(?!github\.com)"
"git\+ssh://"
```
**File**: `package.json`
**Verify**: Are git/file dependencies pointing to trusted sources?
**Severity**: High for unknown sources, Low for internal/trusted

### CHN-005: No Lockfile Enforcement in CI
**Check**: Look for `npm ci`, `yarn --frozen-lockfile`, `pnpm --frozen-lockfile` in CI configs
**Files**: `.github/workflows/*.yml`, `Dockerfile`, `Makefile`, `Jenkinsfile`, `.gitlab-ci.yml`
**Finding**: Uses `npm install` instead of `npm ci` in CI
**Severity**: Medium
