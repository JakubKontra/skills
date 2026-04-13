# Google Search Console — Indexing Issues Reference

Technical reference of all GSC page indexing statuses. Each entry maps to a specific status from the GSC Pages report ("Why pages aren't indexed") and includes the root cause, diagnostic approach, and remediation steps with codebase-level guidance.

Organized by root cause category. IDs (GSC-XXX) are internal to RankPulse for cross-referencing.

---

## Category 1: Server & Access Errors

### GSC-001: Server Error (5xx)
**Priority:** Critical

**Root cause:** The origin server returned a 5xx status when Googlebot requested the URL. The page is completely inaccessible.

**Subtypes:**
- **500** — Unhandled exception or generic server failure. Most frequent.
- **502** — Reverse proxy (nginx, Cloudflare, load balancer) received an invalid response from the upstream.
- **503** — Server is at capacity or in maintenance mode. Typically transient.
- **504** — Upstream timed out. Common with slow database queries or external API calls.

**GSC location:** Pages > "Why pages aren't indexed" > "Server error (5xx)". URL Inspection shows the live status.

**Impact:** Persistent 5xx responses cause Googlebot to reduce crawl rate for the entire host. Pages with sustained errors get deindexed. Cluster-wide 5xx signals unreliability of the whole domain.

**Remediation:**
1. Reproduce the error by hitting affected URLs directly — note the exact status code
2. Look for patterns: same route prefix, same API dependency, same time window
3. Check application logs and server error logs for stack traces
4. Address the root cause: unhandled exceptions, OOM conditions, upstream timeouts, misconfigured reverse proxy
5. After fix, validate via URL Inspection and request reindexing

**Code checks:** Error handling middleware, API route handlers, database connection pooling, timeout configs.

---

### GSC-002: DNS Resolution Failure
**Priority:** Critical

**Root cause:** Googlebot could not resolve the domain name to an IP address. This is a domain-level failure — no pages on the domain are reachable.

**GSC location:** Pages report, indexing issues section. GSC may also send email alerts.

**Impact:** Total crawl failure across all URLs. The entire domain becomes invisible to Google until DNS is restored.

**Remediation:**
1. Verify domain registration hasn't lapsed (check registrar dashboard)
2. Confirm nameserver records point to the correct DNS provider
3. After hosting/DNS migration, allow 24-48h for propagation
4. Use `dig` or online DNS checkers to verify resolution from multiple locations
5. Google resumes crawling automatically once DNS resolves

---

### GSC-003: Server Connectivity Failure
**Priority:** Critical

**Root cause:** DNS resolved correctly but the TCP connection to the server failed — either connection refused, reset, or timed out. The server was unreachable at the network level.

**GSC location:** Pages report, connectivity errors. Settings > Crawl stats shows availability timeline.

**Impact:** Repeated connectivity failures cause Googlebot to throttle crawl frequency. Prolonged outages lead to deindexation. Even intermittent issues slow down discovery of new content.

**Remediation:**
1. Determine if it's a one-off or pattern (check crawl stats timeline and uptime monitoring)
2. Correlate timing with traffic peaks, deployments, or maintenance windows
3. If recurring during peak hours, the server likely needs more capacity
4. Set up uptime monitoring (e.g., UptimeRobot, Pingdom) if not already in place
5. Crawl frequency recovers automatically as uptime stabilizes

---

### GSC-004: HTTP 401 — Authentication Required
**Priority:** High

**Root cause:** The server responded with 401 Unauthorized — the page requires credentials that Googlebot cannot provide. Googlebot does not authenticate.

**GSC location:** Pages > "Blocked due to unauthorized request (401)".

**Impact:** Googlebot cannot crawl or index authenticated pages. If the auth is intentional (staging, admin, member area), this status is correct. If accidental, the page is invisible to search.

**Remediation:**
1. Determine whether the page should be publicly accessible
2. If private: Correct behavior. Investigate how Googlebot discovered the URL (internal links? sitemap?) and clean up references
3. If should be public: Remove HTTP basic auth, check for auth middleware applied to wrong routes, review security plugin configs
4. After removing auth, request reindexing

**Code checks:** Auth middleware scope (is it applied globally instead of per-route?), `.htpasswd` files, reverse proxy auth configs.

---

### GSC-005: Submitted URL — HTTP 401
**Priority:** High

**Root cause:** Same as GSC-004, but the URL is listed in the XML sitemap. The sitemap explicitly requests indexing of a page Googlebot cannot access — a contradictory signal.

**GSC location:** Pages > "Submitted URL returns unauthorized request (401)".

**Impact:** Wastes crawl budget on unreachable URLs. Degrades sitemap trustworthiness — Google may reduce confidence in other sitemap entries too.

**Remediation:**
1. If page should be private: Remove from sitemap immediately
2. If page should be public: Remove authentication and keep in sitemap
3. Audit sitemap generation logic to ensure auth-protected routes are filtered out

**Code checks:** Sitemap generator filtering — does it check route-level auth requirements before including URLs?

---

### GSC-006: HTTP 403 — Access Forbidden
**Priority:** High

**Root cause:** The server returned 403 Forbidden — access is denied regardless of authentication. Unlike 401, providing credentials won't help.

**GSC location:** Pages > "Blocked due to access forbidden (403)".

**Impact:** Page will not be indexed. Common causes: firewall/WAF blocking Googlebot by user-agent or IP, restrictive file permissions, CDN rules.

**Remediation:**
1. If intentional: Consider using `noindex` meta tag for cleaner deindexation semantics. Clean up internal links to these URLs
2. If unintentional: Check server firewall, WAF rules, CDN bot protection settings, file permissions
3. Verify that Googlebot user-agent and IPs are not blocked (but validate authenticity — fake Googlebots exist)
4. After fix, verify via URL Inspection and request reindexing

**Code checks:** WAF/firewall configs, bot-detection middleware, CDN security settings, filesystem permissions.

---

### GSC-007: Submitted URL — HTTP 403
**Priority:** High

**Root cause:** Same as GSC-006, but URL is in the sitemap. Sitemap requests indexing while server denies access.

**GSC location:** Pages > "Submitted URL returned 403".

**Impact:** Contradictory signals waste crawl budget and erode sitemap reliability.

**Remediation:**
1. If access should be blocked: Remove URL from sitemap
2. If access should be allowed: Fix server-side blocking, then verify with URL Inspection
3. Audit sitemap generation to prevent recurrence

---

### GSC-008: Other 4xx Errors
**Priority:** Medium

**Root cause:** The server returned a 4xx status code other than 401, 403, or 404. GSC groups these under a catch-all label.

**Common codes:**
- **400 Bad Request** — Malformed URL, invalid query parameters, encoding problems in the URL itself.
- **410 Gone** — Explicit signal that the resource was permanently removed. Stronger than 404 — Google deindexes faster. If intentional, this is the correct response.
- **429 Too Many Requests** — Rate limiting is throttling Googlebot. Server can't keep up with crawl rate or rate limiter is configured too aggressively.

**GSC location:** Pages > "Blocked due to other 4xx issue".

**Impact:** Page is inaccessible and won't be indexed. Requires investigation to identify the specific HTTP status.

**Remediation:**
1. Use URL Inspection to determine the exact status code
2. **400:** Fix URL generation — look for encoding issues, special characters, or excessively long query strings
3. **410:** No action needed if intentional. If accidental, restore the route
4. **429:** Adjust rate limiting thresholds, configure Googlebot-specific rate limits, or use GSC crawl rate settings
5. Request reindexing after resolution

**Code checks:** URL encoding in link generation, rate limiter configuration, route handler edge cases.

---

### GSC-009: Submitted URL — Other 4xx
**Priority:** Medium

**Root cause:** Same as GSC-008, but URL is in the sitemap.

**GSC location:** Pages > "Submitted URL blocked due to other 4xx issue".

**Impact:** Compounds GSC-008 with sitemap reliability degradation.

**Remediation:**
1. Identify specific status code via URL Inspection
2. Fix the underlying issue or remove URL from sitemap
3. For 410 responses: always remove from sitemap — there's no reason to submit permanently deleted URLs

---

## Category 2: Redirects

### GSC-010: Redirect Error
**Priority:** High

**Root cause:** Googlebot followed a redirect chain that could not be completed. The redirect sequence is broken.

**Failure modes:**
- **Loop** — A → B → A. Circular redirect, often caused by conflicting redirect rules
- **Chain too long** — Googlebot follows a maximum of 5 consecutive redirects before giving up
- **Invalid target** — Redirect destination is malformed, empty, or exceeds URL length limits
- **Broken destination** — Final target returns an error

**GSC location:** Pages > "Redirect error".

**Impact:** The intended destination page cannot be reached by Googlebot and won't be indexed. Link equity flowing through the redirect chain is lost.

**Remediation:**
1. Trace the full redirect chain using `curl -LI <url>` or a redirect checker
2. For loops: Identify conflicting rules in server config. Common cause: www/non-www and HTTPS/HTTP rules interfering
3. For long chains: Rewrite intermediate redirects to point directly to final destination
4. For broken targets: Fix or update the destination URL
5. Request reindexing after fix

**Code checks:** `.htaccess` rewrite rules, `next.config.js`/`nuxt.config.ts` redirect arrays, nginx `return`/`rewrite` directives, middleware redirect logic. Look for conflicting trailing slash and protocol redirect rules.

---

### GSC-011: Page with Redirect
**Priority:** Low

**Root cause:** The URL returns a 3xx redirect to another location. This is informational — Google will attempt to index the redirect target instead.

**GSC location:** Pages > "Page with redirect".

**Impact:** This is expected behavior for legitimately redirected URLs (e.g., after URL restructuring, www/non-www normalization). Not an error.

**Remediation:**
1. No action needed in most cases — this confirms redirects are working
2. Investigate if URLs appear here unexpectedly: accidental redirect rules, trailing slash normalization conflicts, protocol enforcement issues
3. Verify the redirect target is accessible and getting indexed

---

## Category 3: Not Found Errors

### GSC-012: Not Found (404)
**Priority:** High

**Root cause:** The URL returned a 404 status. The page has been deleted, was never created, or has moved without a redirect.

**GSC location:** Pages > "Not found (404)".

**Impact:** Not inherently a problem — content gets removed. Google flags it because it found references (internal or external links) pointing to the URL. Important pages returning 404 lose all accumulated ranking signals and traffic.

**Remediation:**
1. Evaluate each URL: was the content moved or permanently removed?
2. If moved: Set up 301 redirect to the new location
3. If removed with a relevant replacement: 301 redirect to the closest alternative page
4. If removed with no replacement: Leave the 404 — it's the correct response. Google will stop crawling it over time
5. Audit internal links pointing to 404 URLs and update them

**Code checks:** Search for `<a href="...">` references pointing to non-existent routes. Check navigation components, footer links, content with hardcoded URLs.

---

### GSC-013: Submitted URL — Not Found (404)
**Priority:** High

**Root cause:** A URL in the XML sitemap returns 404. The sitemap declares a page that doesn't exist.

**GSC location:** Pages > "Submitted URL not found (404)".

**Impact:** Sitemap contains invalid entries. This wastes crawl budget and reduces Google's trust in the sitemap as a reliable index of the site's content.

**Remediation:**
1. If the page moved: Add 301 redirect and update sitemap to reflect the new URL
2. If permanently gone: Remove from sitemap
3. Audit sitemap generation — stale cache, missing route cleanup, or CMS misconfiguration are common causes
4. Sitemap should only contain URLs returning 200 that are meant to be indexed

**Code checks:** Sitemap generation logic — does it validate route existence? Does it respect deleted/unpublished content?

---

### GSC-014: Soft 404
**Priority:** High

**Root cause:** The URL returns HTTP 200 but the rendered content signals an error condition — "Not found", "No results", "This page doesn't exist", or content so thin it provides no value. Google's classifier determines the page behaves like a 404 despite the successful status code.

**GSC location:** Pages > "Soft 404". Prevalent on e-commerce (out-of-stock products) and search/filter pages generating empty results.

**Impact:** These URLs consume crawl budget while providing no indexable value. At scale, they signal to Google that large portions of the site are empty.

**Remediation:**
1. Identify the page type and why it appears empty
2. If the content truly doesn't exist: Return proper 404 (or 410) status code instead of 200
3. If temporarily unavailable (e.g., out-of-stock product): Retain useful content on the page — description, images, availability estimate, related items
4. If it's a search/filter page with zero results: Add `noindex` meta tag
5. If content is too thin to be useful: Either expand it substantively or deindex

**Code checks:** Dynamic page templates — find the empty state branch. Does `getServerSideProps`/`getStaticProps`/loader return 200 when the underlying data is missing? It should return `{ notFound: true }` or equivalent.

---

### GSC-015: Submitted URL — Soft 404
**Priority:** High

**Root cause:** Same as GSC-014, but the URL is in the sitemap. The sitemap points Google to pages with no real content.

**GSC location:** Pages > "Submitted URL seems to be a Soft 404".

**Remediation:**
1. Apply all GSC-014 fixes
2. Additionally, remove these URLs from the sitemap or fix the content
3. Review sitemap generation to filter out pages that resolve to empty states

---

## Category 4: Blocked Pages

### GSC-016: Blocked by robots.txt
**Priority:** Medium

**Root cause:** A `Disallow` rule in `robots.txt` prevents Googlebot from crawling this URL.

**GSC location:** Pages > "Blocked by robots.txt". Use the robots.txt Tester to identify the matching rule.

**Impact:** If intentional (blocking `/api/`, `/admin/`, internal tooling), this is correct. If accidental, the page cannot be indexed. Note: `robots.txt` prevents crawling but not indexing — Google can still index the URL (without content) if external links point to it.

**Remediation:**
1. If intentional: No action. For pages that should also not appear in search index, prefer `noindex` meta tag — it's more definitive
2. If accidental: Edit `robots.txt` to remove or narrow the blocking rule
3. Watch for overly broad patterns — `Disallow: /search` also blocks `/search-engine`, `/search-results`, etc.
4. Test changes with robots.txt Tester before deploying

**Code checks:** Read `robots.txt`, check for wildcard `Disallow` rules. Verify that key content paths are not inadvertently covered.

---

### GSC-017: Submitted URL Blocked by robots.txt
**Priority:** High

**Root cause:** A URL in the sitemap is blocked by `robots.txt`. These are conflicting directives: the sitemap says "please index" while `robots.txt` says "don't crawl."

**GSC location:** Pages > "Submitted URL blocked by robots.txt".

**Impact:** Google cannot crawl the page. The contradictory signals confuse prioritization and waste crawl budget.

**Remediation:**
1. If page should be indexed: Remove the `robots.txt` block
2. If page should not be indexed: Remove it from the sitemap (and optionally add `noindex`)
3. Sitemap URLs and `robots.txt` allow rules must be consistent
4. Audit sitemap generation to prevent submitting blocked URLs

**Code checks:** Programmatically cross-reference sitemap output against `robots.txt` `Disallow` patterns.

---

### GSC-018: Indexed Despite robots.txt Block
**Priority:** Medium

**Root cause:** Google indexed the URL even though `robots.txt` blocks crawling. This occurs when enough external signals (inbound links, anchor text) exist for Google to create an index entry without actually reading the page.

**GSC location:** Pages > "Indexed, though blocked by robots.txt". Shown as a warning.

**Impact:** The indexed entry has a poor or missing snippet since Google couldn't read the page content. It appears in results based on external link context only.

**Remediation:**
1. If the page should be properly indexed: Remove the `robots.txt` block so Google can read the content
2. If the page should not be indexed at all: `robots.txt` alone is insufficient. Add a `noindex` meta tag. Temporarily unblock crawling so Googlebot can discover the `noindex` directive, then optionally re-block after deindexation

---

### GSC-019: Excluded by noindex
**Priority:** Low

**Root cause:** The page contains a `<meta name="robots" content="noindex">` tag or sends an `X-Robots-Tag: noindex` HTTP header. Google respects the directive and excludes the page from the index.

**GSC location:** Pages > "Excluded by 'noindex' tag".

**Impact:** Correct behavior for pages that shouldn't appear in search (admin panels, thank-you pages, filtered/sorted views, internal search results). Problem only if the `noindex` is unintentional.

**Remediation:**
1. If intentional: No action required
2. If accidental: Locate and remove the directive — check meta tags in HTML `<head>`, HTTP response headers, CMS "search visibility" settings, framework SEO config
3. After removal, request reindexing

**Code checks:** Grep for `noindex` across meta tags, response headers, and framework config files (`next-seo` defaults, `nuxt.config` `robots` property, `gatsby-config` plugin options).

---

### GSC-020: Submitted URL with noindex
**Priority:** High

**Root cause:** A URL in the sitemap has a `noindex` directive. The sitemap requests indexing while the page itself refuses it.

**GSC location:** Pages > "Submitted URL marked 'noindex'".

**Impact:** Contradictory signals. Google follows `noindex` and the page won't be indexed. The sitemap entry is wasted.

**Remediation:**
1. If page should be indexed: Remove the `noindex` directive
2. If page should not be indexed: Remove it from the sitemap
3. Fix sitemap generation to exclude `noindex` pages

---

### GSC-021: Excluded by noindex (alternate label)
**Priority:** Low

**Root cause:** Identical to GSC-019. This is an alternate label GSC uses in the "Excluded" section to emphasize deliberate exclusion.

**GSC location:** Pages > "Excluded by 'noindex' tag".

**Remediation:** Same as GSC-019.

---

### GSC-022: Removed via URL Removal Tool
**Priority:** Medium

**Root cause:** A site owner or GSC property user submitted a temporary removal request via the URL Removal Tool. The page is hidden from search results for approximately 90 days.

**GSC location:** Pages > "Blocked by page removal tool". Also visible under GSC Removals section.

**Impact:** The removal is temporary. After ~90 days, Google can re-crawl and reindex the page. This tool is meant for emergencies — it buys time but doesn't permanently resolve anything.

**Remediation:**
1. If permanent removal intended: Implement `noindex` or delete the page before the 90-day window expires
2. If removal was a mistake: Cancel the request in GSC > Removals
3. If you didn't submit it: Audit GSC property access — another user may have requested the removal

---

## Category 5: Crawl & Indexing Status

### GSC-023: Crawled, Not Indexed
**Priority:** Medium

**Root cause:** Googlebot successfully crawled the page (no technical errors) but chose not to add it to the index. This is a quality/value judgment by Google — the page was readable but deemed not worth indexing.

**GSC location:** Pages > "Crawled - currently not indexed".

**Impact:** No technical error to fix — this is Google's editorial decision. Common reasons: thin or shallow content, substantial overlap with other indexed pages, weak internal linking (page appears unimportant within the site hierarchy), or the page simply hasn't been prioritized yet.

**Remediation:**
1. Check the crawl date — if recent, wait. Google doesn't index everything immediately
2. If stuck for weeks, evaluate critically:
   - Is the content substantive and unique?
   - Does the page have internal links from well-linked pages?
   - Is it similar to another page that IS indexed? Consider consolidating
3. Improve content quality and internal linking, then request reindexing

**Code checks:** Internal link graph — is the page reachable from navigation or content links? Is it orphaned?

---

### GSC-024: Discovered, Not Indexed
**Priority:** Medium

**Root cause:** Google knows the URL exists (found it via sitemap, internal links, or external links) but has not yet crawled it. The page is queued for crawling.

**GSC location:** Pages > "Discovered - currently not indexed".

**Impact:** For newly published pages, this is normal — Google will get to it. For pages stuck in this state for weeks, it indicates a crawl budget or prioritization problem. Google is choosing to spend its crawl budget elsewhere.

**Remediation:**
1. For new pages: Be patient — Google will crawl on its own schedule
2. If stuck for extended periods:
   - Reduce crawl budget waste: `noindex` or block low-value pages (faceted navigation, empty tag pages, pagination)
   - Improve internal linking to the stuck pages from high-authority pages
   - Check server response times — slow servers cause Google to throttle crawling
   - Submit URL directly in GSC URL Inspection

**Code checks:** Internal link coverage, sitemap inclusion, server response time metrics.

---

### GSC-025: Submitted URL — Crawl Issue
**Priority:** High

**Root cause:** Google attempted to crawl a URL from the sitemap but encountered an unclassified problem — doesn't fit into other specific error categories. Often transient: a timeout, a momentary server glitch, or a resource loading failure.

**GSC location:** Pages > "Submitted URL has crawl issue".

**Impact:** The page remains unindexed. If the issue is transient, it may resolve on the next crawl attempt. Persistent issues indicate a deeper problem.

**Remediation:**
1. Test the URL live via URL Inspection — if it works now, the issue was likely transient. Request reindexing
2. If it persists:
   - Check server logs for the specific error at crawl time
   - Look for JS-heavy pages that might timeout during rendering
   - Check for very large page sizes or slow external resource dependencies
3. After resolving, request reindexing

---

## Category 6: Canonicals & Duplicates

### GSC-026: Alternate Page — Canonical Configured Correctly
**Priority:** Low

**Root cause:** This page is a recognized duplicate/variant and has a `rel=canonical` tag correctly pointing to the preferred version. Google understood and followed the instruction.

**GSC location:** Pages > "Alternate page with proper canonical tag".

**Impact:** Not an error — this confirms canonical tags are working as designed. Typical for URL parameter variants, pagination, mobile/desktop versions, or localized alternates.

**Remediation:**
1. No action needed — working correctly
2. Monitor for unexpected spikes that could indicate accidental duplication at scale
3. If a page listed here should actually be indexed independently: remove or self-reference the canonical tag

---

### GSC-027: Duplicate — No Canonical Specified
**Priority:** Medium

**Root cause:** Google detected duplicate content across multiple URLs, but none of them declare a canonical preference. Google is choosing which version to index on its own.

**GSC location:** Pages > "Duplicate without user-selected canonical".

**Impact:** Without explicit canonical signals, Google guesses the preferred URL. It may choose wrong — the "wrong" URL appears in results and accumulates ranking signals while the preferred version is ignored.

**Remediation:**
1. Identify the duplicate URLs and determine the preferred canonical version (typically the cleanest URL, no parameters, consistent trailing slash)
2. Add `rel=canonical` tags on all versions pointing to the preferred URL
3. If the pages are not truly duplicates: differentiate the content so Google treats them as unique

**Code checks:** Check for pages accessible via multiple URL patterns (with/without trailing slash, www/non-www, HTTP/HTTPS, query parameters). Ensure canonical tags are set in layout templates or SEO config.

---

### GSC-028: Google Chose Different Canonical
**Priority:** Medium

**Root cause:** A `rel=canonical` tag is set, but Google disagrees with the declared preference and selected a different URL as the canonical. Google overrides canonical hints when other signals are stronger.

**GSC location:** Pages > "Duplicate, Google chose different canonical than user".

**Impact:** The page you designated as canonical is not the one Google indexes. This typically happens when the chosen canonical has fewer inbound links, weaker content, or conflicting signals from redirects/hreflang.

**Remediation:**
1. Use URL Inspection to see which URL Google selected — evaluate if Google's choice is actually better
2. If Google is right: Update your canonical tags to match
3. If your canonical is correct: Strengthen signals for the preferred URL:
   - Increase internal links to the preferred version
   - Ensure the preferred URL has the strongest content
   - Eliminate conflicting signals (redirects, hreflang, internal links pointing to the non-preferred version)
   - Verify canonical tag uses absolute URL with correct protocol and trailing slash convention

**Code checks:** Canonical tag format — absolute URLs? Correct protocol (https)? Consistent trailing slash? No conflicting redirect rules?

---

### GSC-029: Submitted URL — Not Selected as Canonical
**Priority:** Medium

**Root cause:** A URL in the sitemap is a duplicate, has no canonical tag, and Google chose a different URL as the canonical version.

**GSC location:** Pages > "Duplicate, submitted URL not selected as canonical".

**Impact:** The sitemap points to a URL Google considers secondary. The preferred version may or may not be in the sitemap.

**Remediation:**
1. Add canonical tags to establish clear preferences across duplicate URLs
2. If the submitted URL should be canonical: Add self-referencing canonical and point all duplicates to it
3. If Google's choice is correct: Update sitemap to include the canonical URL instead
4. Sitemap should only list canonical versions of pages

---

## Category 7: Content Issues

### GSC-030: Indexed Without Content
**Priority:** High

**Root cause:** Google indexed the URL but could not extract any meaningful content from the rendered page. The page may be blank, render content only via client-side JavaScript that Googlebot couldn't execute, or display content only after authentication that happens post-load.

**GSC location:** Pages > "Indexed without content". Use URL Inspection > "View Tested Page" to see what Google rendered.

**Impact:** The page exists in the index but with no snippet, no keyword relevance, and no ranking potential. It's a wasted index entry.

**Remediation:**
1. Compare what you see in a browser vs what URL Inspection > "View Tested Page" shows
2. If content is visible to you but not to Google: Client-side rendering issue. Implement SSR/SSG for critical content
3. If genuinely empty: Add content or remove/noindex the page
4. If content loads behind a post-page-load authentication gate: This is effectively cloaking. Public URLs must serve public content
5. If it's an unfinished page: Add `noindex` until content is ready

**Code checks:** Check for critical content rendered exclusively via client-side JS. Look for empty component shells, loading spinners without SSR fallback, auth-gated content on public routes.

---

### GSC-031: Indexed But Not in Sitemap
**Priority:** Low

**Root cause:** Google found and indexed this page through crawling (internal links, external links) but the URL is not in the XML sitemap. This is informational.

**GSC location:** Pages > "Indexed, not submitted in sitemap".

**Impact:** Not an error. Many legitimately indexed pages may not be in the sitemap. However, missing important pages from the sitemap is a lost opportunity to signal their existence and priority to Google.

**Remediation:**
1. Review flagged URLs — are they pages that should be in the sitemap?
2. If important: Add to sitemap. Check sitemap generation for overly restrictive filters
3. If low-value or unintended: Consider `noindex` if they shouldn't be in search at all
4. Not every page needs sitemap inclusion — prioritize canonical, high-value pages

**Code checks:** Review sitemap generation completeness — are all public, indexable page routes represented?

---

### GSC-032: Removed Due to Legal Request
**Priority:** High

**Root cause:** The page was deindexed in response to a legal complaint, typically a DMCA copyright takedown notice.

**GSC location:** Pages > "Page removed because of legal complaint". Details available in the Lumen database (lumendatabase.org).

**Impact:** This is a legal matter. The page has been removed from Google's index by court order or valid legal process.

**Remediation:**
1. If the complaint is valid: Remove the infringing content from the page. After removal, you may submit a counter-notification to restore indexing
2. If the complaint is fraudulent: File a counter-notification through Google's DMCA process (this carries legal implications — understand the process before proceeding)
3. Check GSC messages and email for notification details
4. Review the specific complaint on lumendatabase.org
