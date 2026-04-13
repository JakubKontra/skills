# SEO Code Check Patterns

Detection patterns for codebase-level SEO issues. Used by RankPulse during Step 4 (Codebase SEO Audit). Each category has grep patterns, target files, verification rules, and severity classification.

---

## META — Title, Description, Open Graph, Twitter Cards

### META-001: Missing Page Title
**Severity:** High
**Pattern:** Absence check — look for pages/layouts WITHOUT `<title>` or framework equivalent
**Target files:** `**/*.{html,jsx,tsx,vue,svelte,astro}`, layout files, `_app.*`, `layout.*`
**Verification:**
- Check if title is set via framework (e.g., Next.js `metadata`, `next-seo`, `react-helmet`, `@vueuse/head`)
- Dynamic pages may set title via data fetching — read the component logic
- A single missing title on a high-traffic template affects all pages using it

### META-002: Missing Meta Description
**Severity:** High
**Pattern:** `<meta\s+name=["']description["']` — check for absence in page templates
**Target files:** Same as META-001
**Verification:**
- Framework-specific: check `metadata.description`, SEO component props, head management
- Empty descriptions (`content=""`) count as missing

### META-003: Missing Open Graph Tags
**Severity:** Medium
**Pattern:** `og:title|og:description|og:image|og:url|og:type`
**Target files:** Layout files, SEO config, head components
**Verification:**
- Minimum viable OG: `og:title`, `og:description`, `og:image`
- Check if set globally via layout or per-page
- Missing `og:image` means poor social media previews

### META-004: Missing Twitter Card Tags
**Severity:** Low
**Pattern:** `twitter:card|twitter:title|twitter:description|twitter:image`
**Target files:** Same as META-003
**Verification:**
- `twitter:card` is the minimum (`summary` or `summary_large_image`)
- Many sites use OG tags as fallback — check if that's intentional

### META-005: Duplicate Titles Across Pages
**Severity:** Medium
**Pattern:** Look for hardcoded identical title strings across multiple page files
**Verification:**
- Dynamic titles from data are fine
- Template titles like "My Site" without page-specific prefix are a problem
- Check if title template is configured (e.g., `%s | Site Name`)

---

## ROBOTS — robots.txt and Meta Robots

### ROBOTS-001: Missing robots.txt
**Severity:** High
**Pattern:** Check for `robots.txt` in `public/`, `static/`, or project root
**Verification:**
- Framework-specific locations: Next.js `app/robots.ts`, Nuxt `server/routes/robots.txt.ts`
- Dynamic generation via API route counts as present

### ROBOTS-002: Overly Restrictive robots.txt
**Severity:** Critical
**Pattern:** `Disallow:\s*/\s*$` (blocks entire site)
**Target files:** `**/robots.txt`, `**/robots.ts`, `**/robots.js`
**Verification:**
- `Disallow: /` blocks everything — often a leftover from staging
- Check for `User-agent: *` combined with broad Disallow rules
- Wildcard patterns that accidentally block important sections

### ROBOTS-003: No Sitemap Reference in robots.txt
**Severity:** Medium
**Pattern:** `Sitemap:` — check for presence in robots.txt
**Verification:**
- Should contain `Sitemap: https://domain.com/sitemap.xml` (absolute URL)
- Multiple sitemap references are fine (sitemap index)

### ROBOTS-004: Accidental noindex in Production
**Severity:** Critical
**Pattern:** `noindex` in meta tags, headers, or framework config
**Target files:** Layout files, server config, middleware, `next.config.*`, `nuxt.config.*`
**Verification:**
- Environment-conditional noindex is fine IF properly gated
- Check for `<meta name="robots" content="noindex">` without env condition
- Check `X-Robots-Tag` headers in server/middleware config
- CMS "discourage search engines" settings

---

## SITEMAP — Sitemap Presence and Quality

### SITEMAP-001: Missing Sitemap
**Severity:** High
**Pattern:** Check for `sitemap.xml` in `public/`, or dynamic generation
**Target files:** `**/sitemap*`, `**/sitemap.ts`, `**/sitemap.js`, `**/sitemap.xml`
**Verification:**
- Framework-specific: Next.js `app/sitemap.ts`, Nuxt sitemap module, gatsby-plugin-sitemap
- Programmatic sitemap generation via packages counts

### SITEMAP-002: Sitemap Not Referenced
**Severity:** Medium
**Pattern:** Cross-check robots.txt for `Sitemap:` directive
**Verification:**
- Sitemap should be referenced in robots.txt with absolute URL
- Also submit sitemap directly in GSC

### SITEMAP-003: Static Sitemap (Not Auto-Generated)
**Severity:** Low
**Pattern:** Check if sitemap is a static XML file vs dynamically generated
**Verification:**
- Static sitemaps go stale as pages are added/removed
- Dynamic generation from routes/content is preferred
- Check last modified date if static

---

## CANONICAL — Canonical Tags

### CANONICAL-001: Missing Canonical Tags
**Severity:** High
**Pattern:** `<link\s+rel=["']canonical["']` or `canonical` in head management
**Target files:** Layout files, SEO components, head config
**Verification:**
- Every indexable page should have a self-referencing canonical
- Check framework SEO plugins for automatic canonical handling
- Missing canonicals = Google guesses the preferred URL

### CANONICAL-002: Relative Canonical URLs
**Severity:** Medium
**Pattern:** `rel=["']canonical["']\s+href=["']/` (starts with `/` instead of `https://`)
**Verification:**
- Canonicals MUST be absolute URLs (`https://domain.com/page`)
- Relative URLs are technically valid but can cause issues with different base URLs

### CANONICAL-003: Trailing Slash Inconsistency
**Severity:** Medium
**Pattern:** Check `trailingSlash` config in framework settings
**Target files:** `next.config.*`, `nuxt.config.*`, `gatsby-config.*`, server config
**Verification:**
- Should be consistent: always trailing slash or never
- Inconsistency causes duplicate content (Google sees `/page` and `/page/` as different URLs)
- Check canonical tags match the chosen convention

---

## SCHEMA — Structured Data / JSON-LD

### SCHEMA-001: No Structured Data
**Severity:** Medium
**Pattern:** `application/ld\+json|structured.?data|json-?ld|schema\.org`
**Target files:** `**/*.{html,jsx,tsx,vue,svelte}`, SEO components, layout files
**Verification:**
- Not every page needs structured data, but key pages benefit:
  - Homepage: Organization/WebSite
  - Articles: Article/BlogPosting
  - Products: Product
  - FAQ pages: FAQPage
  - Local business: LocalBusiness

### SCHEMA-002: Invalid JSON-LD Syntax
**Severity:** Medium
**Pattern:** `<script\s+type=["']application/ld\+json["']>`
**Verification:**
- Parse the JSON-LD content for valid JSON
- Check for required fields per schema type
- Check `@context` is `https://schema.org`

---

## HEADINGS — Heading Hierarchy

### HEADINGS-001: Missing H1
**Severity:** Medium
**Pattern:** `<h1|<Heading.*level.*1|variant.*h1`
**Target files:** Page components, templates
**Verification:**
- Every page should have exactly one H1
- Check if H1 is rendered conditionally or dynamically
- H1 in layout that repeats on every page is a problem

### HEADINGS-002: Multiple H1 Tags
**Severity:** Medium
**Pattern:** Count `<h1` occurrences per page template
**Verification:**
- One H1 per page is the recommendation
- Multiple H1s from different components on the same page is an issue
- Check if framework layout + page both define H1

---

## IMAGES — Alt Text Coverage

### IMAGES-001: Images Without Alt Text
**Severity:** Medium
**Pattern:** `<img(?![^>]*alt=)` or `alt=["']["']` (empty alt)
**Target files:** `**/*.{html,jsx,tsx,vue,svelte}`
**Verification:**
- Decorative images can have `alt=""` (intentionally empty) — this is accessible, not an error
- Content images must have descriptive alt text
- Check for `next/image` or similar components that enforce alt props
- Framework-level linting (eslint-plugin-jsx-a11y) may already catch this

---

## LINKS — Internal Linking

### LINKS-001: Orphaned Pages
**Severity:** Medium
**Pattern:** Compare pages/routes against internal link targets
**Verification:**
- Pages with no internal links pointing to them are hard for Google to discover
- Check navigation, sidebar, footer, content links
- Sitemap helps but doesn't replace internal linking

### LINKS-002: Broken Internal Links
**Severity:** High
**Pattern:** Extract `href` values and cross-reference with existing routes
**Target files:** `**/*.{html,jsx,tsx,vue,svelte,md,mdx}`
**Verification:**
- Links to deleted pages, misspelled routes, or old URL structures
- Dynamic links from data may need runtime checking

---

## I18N — Internationalization SEO

### I18N-001: Missing Hreflang Tags
**Severity:** Medium (when i18n is enabled)
**Pattern:** `hreflang|alternate.*hreflang`
**Target files:** Layout files, head management, SEO config
**Verification:**
- Required when site has multiple language versions
- Each language version should reference all other versions
- Must include self-referencing hreflang
- Check for `x-default` hreflang

### I18N-002: Missing Language Attribute
**Severity:** Low
**Pattern:** `<html\s+lang=` — check for `lang` attribute on `<html>` tag
**Target files:** Root layout, document template, `_document.*`
**Verification:**
- `<html lang="en">` or appropriate language code
- Should be dynamic for multi-language sites

---

## PERF — Performance SEO Signals

### PERF-001: Render-Blocking Resources
**Severity:** Medium
**Pattern:** `<link.*rel=["']stylesheet["'](?!.*media=)` in `<head>` without async/defer indicators
**Target files:** Layout files, document templates
**Verification:**
- Critical CSS should be inlined or loaded with `media` strategy
- Check for `next/font`, font loading strategies
- Large CSS files in head without optimization

### PERF-002: Missing Image Lazy Loading
**Severity:** Low
**Pattern:** `<img(?![^>]*loading=["']lazy["'])(?![^>]*priority)` 
**Target files:** `**/*.{html,jsx,tsx,vue,svelte}`
**Verification:**
- Below-fold images should use `loading="lazy"`
- Above-fold images should NOT be lazy (check for `priority` prop in next/image)
- Framework image components may handle this automatically

### PERF-003: Missing Image Dimensions
**Severity:** Medium
**Pattern:** `<img(?![^>]*width=)(?![^>]*height=)`
**Target files:** `**/*.{html,jsx,tsx,vue,svelte}`
**Verification:**
- Missing width/height causes layout shifts (CLS)
- Framework image components often require dimensions
- CSS-sized images still benefit from HTML dimensions for CLS prevention
