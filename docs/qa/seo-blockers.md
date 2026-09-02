# NodeZero.social SEO Audit — Engineering Handoff

**Audit date:** 2026-08-28 (America/Los_Angeles)  
**Scope:** Live public `nodezero.social`, `www` variant, redirected staging experience, `robots.txt`, `sitemap.xml`, rendered HTML, metadata, canonicalization, structured data, headings, internal links, indexation signals, performance indicators, mobile/accessibility factors, and public content strategy.

## Executive summary

NodeZero.social is not presently operating as an indexable public marketing/content site. The apex homepage sends users and crawlers to `https://staging.nodezero.social/`; the delivered document canonically identifies that staging URL; and the resulting page is a sign-in/onboarding application titled only “NodeZero.” The initial HTML contains no meaningful public copy, navigation links, description metadata, social metadata, or structured data. Public crawl discovery is also broken: `/robots.txt` returns an Azure Static Web Apps 404, while sitemap endpoints do not provide a valid XML sitemap.

This is a release-blocking SEO configuration problem, not a collection of minor on-page optimizations. The highest-value action is to separate the public marketing surface from the authenticated product, restore a single production hostname, and ship crawlable server-rendered content with correct discovery files and metadata.

### Overall assessment

| Area | Rating | Main reason |
|---|---:|---|
| Crawlability and discovery | Critical | Missing robots file and sitemap; public root routes to staging |
| Canonicalization/indexation | Critical | Production URL resolves to staging and canonical names staging |
| Rendered/search-visible content | Critical | App shell has almost no useful source content; public page is authentication UI |
| Metadata and structured data | Poor | Generic title; no description, Open Graph, Twitter cards, or JSON-LD |
| Information architecture/internal links | Critical | No crawlable internal links on the rendered home experience |
| Performance/CWV readiness | High risk | JS application shell and large client bundle are prerequisites for useful rendering |
| Mobile/accessibility SEO factors | Needs work | Viewport exists, but locked body scrolling and weak semantic structure create risk |
| Public content strategy | Critical gap | No indexable explanation, use cases, trust content, documentation hub, or editorial surface |

## Priority register

| ID | Severity | Fix | Impact | Suggested owner |
|---|---|---|---|---|
| NZ-SEO-001 | P0 / Critical | Stop redirecting production to staging; establish one production canonical host | Restores valid brand/index target | Platform / DNS / Web |
| NZ-SEO-002 | P0 / Critical | Create a server-rendered public marketing site separate from sign-in | Gives crawlers and prospects indexable content | Web / Product |
| NZ-SEO-003 | P0 / Critical | Publish valid `/robots.txt` and `/sitemap.xml` | Enables reliable crawling and URL discovery | Web / Platform |
| NZ-SEO-004 | P0 / Critical | Correct canonical logic by environment and route | Prevents production URLs consolidating into staging | Web |
| NZ-SEO-005 | P1 / High | Add unique titles, descriptions, Open Graph, and Twitter metadata | Improves relevance and search/social snippets | Web / Content |
| NZ-SEO-006 | P1 / High | Add crawlable navigation and content hierarchy | Enables discovery and distributes internal authority | Web / Content |
| NZ-SEO-007 | P1 / High | Add Organization/WebSite/Product structured data | Improves entity understanding and eligibility | Web |
| NZ-SEO-008 | P1 / High | Establish CWV budgets and measure production templates | Protects rankings and user experience | Web / Performance |
| NZ-SEO-009 | P1 / High | Apply `noindex` to staging and authenticated/private routes | Prevents environment and thin-app indexation | Platform / Web |
| NZ-SEO-010 | P2 / Medium | Repair semantics, mobile scrolling, form autocomplete, and accessible navigation | Improves mobile/accessibility signals and usability | Web / Design System |
| NZ-SEO-011 | P2 / Medium | Build keyword-led public content clusters and trust pages | Creates sustained organic acquisition | Marketing / Product |

## Evidence and findings

### 1. Production hostname resolves to staging

**Severity: P0 / Critical**

Observed from a fresh public browser session:

- Requested: `https://nodezero.social/`
- Final browser URL: `https://staging.nodezero.social/`
- Visible environment label: “NodeZero Staging”
- Canonical in delivered document: `https://staging.nodezero.social/`

**Why it matters:** Search engines are being told that the staging URL is authoritative. Signals earned by the production domain can consolidate to staging, and users see a non-production environment.

**Implementation:**

1. Make `https://nodezero.social/` (or `https://www.nodezero.social/`, choose one) the only public canonical hostname.
2. 301 redirect the non-preferred production hostname to the preferred one, preserving path and query string.
3. Remove every production-to-staging redirect at DNS, edge, Static Web Apps, framework middleware, and application-router layers.
4. Generate canonical URLs from an environment-specific `PUBLIC_SITE_URL`, never a hard-coded staging value.
5. Add deployment tests that fail when production HTML contains `staging.nodezero.social`.

**Acceptance test:** `curl -I` against apex and `www` produces at most one 301 hop to the chosen production hostname; final HTML contains a self-referencing production canonical.

### 2. Public homepage is an authentication/onboarding screen

**Severity: P0 / Critical**

Rendered content is centered on “Sign in to your node,” device identity creation/restoration, handle selection, and notification email. It contains one H1 (“NodeZero”), zero crawlable links, and no public product explanation, use cases, proof, pricing, documentation, company information, or editorial content.

**Why it matters:** The page does not satisfy informational or commercial search intent and provides no crawl path to additional content.

**Implementation:**

- Serve a public, server-rendered `/` with a clear value proposition, audience, product explanation, use cases, proof/trust, primary CTA, and text links to deeper pages.
- Move application access to `app.nodezero.social` or `/app`; apply authentication and `noindex, nofollow` where appropriate.
- Keep primary marketing copy in initial HTML via SSR/SSG. Do not make essential content dependent on client execution.

### 3. Robots and sitemap discovery are broken

**Severity: P0 / Critical**

- `https://nodezero.social/robots.txt` displayed **Azure Static Web Apps — 404: Not Found**.
- `https://nodezero.social/sitemap.xml` did not produce a readable XML sitemap.
- Staging `/robots.txt` and `/sitemap.xml` rendered application “Unmatched Route / Not Found” content.

**Implementation:**

Production `/robots.txt`:

```txt
User-agent: *
Allow: /
Disallow: /app/
Disallow: /account/
Disallow: /api/
Sitemap: https://nodezero.social/sitemap.xml
```

Staging response header or meta:

```http
X-Robots-Tag: noindex, nofollow, noarchive
```

Generate a UTF-8 XML sitemap containing only canonical, indexable, 200-status production URLs. Split by content type after 50,000 URLs/50 MB and use a sitemap index. Populate accurate `<lastmod>` values only when content materially changes.

### 4. Metadata is insufficient

**Severity: P1 / High**

Observed head signals:

- `<title>NodeZero</title>` only
- No meta description
- No Open Graph fields
- No Twitter card fields
- No robots meta directive
- `lang="en"` and viewport are present

**Implementation:** Every indexable template must emit a unique, intent-led title and description, a self-referencing absolute canonical, OG/Twitter metadata, and an absolute share image. Example homepage direction (final language should follow confirmed positioning):

```html
<title>NodeZero — [Primary category/value proposition]</title>
<meta name="description" content="[Specific audience, capability, differentiator, and outcome in natural language.]">
<link rel="canonical" href="https://nodezero.social/">
<meta property="og:type" content="website">
<meta property="og:title" content="NodeZero — [Value proposition]">
<meta property="og:description" content="[Concise benefit statement]">
<meta property="og:url" content="https://nodezero.social/">
<meta property="og:image" content="https://nodezero.social/og/home.png">
<meta name="twitter:card" content="summary_large_image">
```

### 5. No structured data

**Severity: P1 / High**

No `application/ld+json` blocks were present.

**Implementation:** Add valid JSON-LD that matches visible claims:

- `Organization` with official name, production URL, logo, and verified `sameAs` profiles.
- `WebSite` on the homepage.
- `SoftwareApplication` or `Product` only if the public offering fits the type and all named properties are visible.
- `BreadcrumbList` on deeper content pages.
- `Article`/`TechArticle` for editorial or documentation content.

Do not add ratings, pricing, FAQs, or social profiles that are not publicly visible and verifiable. Validate in Schema.org Validator and Google Rich Results Test.

### 6. Heading and semantic hierarchy is too thin

**Severity: P1 / High**

The rendered route exposed a single H1 (“NodeZero”) and no H2/H3 hierarchy. Much of the visible UI is implemented as generic `div` text. There are no navigation or footer links.

**Implementation:** Use exactly one descriptive H1 for the page’s primary topic; use H2s for value, capabilities, audiences/use cases, trust, and FAQs; use semantic `header`, `nav`, `main`, `section`, and `footer`; and make all navigational items real anchor elements with stable URLs.

### 7. Internal linking and information architecture are absent

**Severity: P1 / High**

The rendered homepage contained zero `<a href>` elements.

**Implementation:** Establish crawlable hubs such as:

- `/product` or `/platform`
- `/solutions/[audience-or-use-case]`
- `/how-it-works`
- `/security`, `/privacy`, `/trust`
- `/developers` or `/docs`
- `/about`
- `/blog` or `/resources`
- `/contact` and a clearly separated `/app` sign-in

Link every important page from HTML navigation or relevant contextual copy; avoid JS-only click handlers for navigation; use descriptive anchor text; add breadcrumbs to deeper pages; and keep orphan pages at zero.

### 8. Indexation signals and public search presence are weak

**Severity: P1 / High**

A public `site:nodezero.social` search did not surface a meaningful NodeZero.social result during the audit. Search results for the name were dominated by unrelated brands and similarly named products. This is an observational signal, not a definitive index count; Search Console is the source of truth.

**Implementation:** After P0 fixes, verify ownership in Google Search Console and Bing Webmaster Tools; submit the sitemap; inspect canonical selection for representative URLs; monitor Crawled/Discovered — currently not indexed; and request indexing only for the homepage and a small set of launch-critical pages after validation.

### 9. Performance and Core Web Vitals risk

**Severity: P1 / High**

The page is an Expo/React Native Web application and loads a fingerprinted client bundle (`/_expo/static/js/web/index-…js`). Useful content is not meaningfully represented in the original app shell, so rendering depends heavily on JavaScript. The CSS locks `body { overflow: hidden; }`, which is risky for content pages and mobile usability.

No field CWV data was available in the inspected surface, so LCP/INP/CLS are **not claimed as measured failures**. The architecture nevertheless creates a high risk of slow content discovery, main-thread work, and unstable template performance.

**Implementation and budgets:**

- Marketing pages: SSG/SSR with progressive enhancement; hydrate only interactive islands.
- LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at the 75th percentile for mobile and desktop.
- Initial JS target ≤ 170 KB compressed for the homepage unless evidence justifies more.
- Inline critical CSS; defer noncritical code; code-split application/auth flows away from marketing.
- Use responsive AVIF/WebP images with dimensions and `srcset`; preload only the true LCP image/font.
- Self-host/subset fonts where licensing allows; use `font-display: swap` and metric-compatible fallbacks.
- Apply long immutable caching to fingerprinted assets and short revalidation to HTML.
- Run Lighthouse CI on mobile for every indexable template and collect real-user web-vitals telemetry.

### 10. Mobile and accessibility factors affecting SEO

**Severity: P2 / Medium**

Positive signals: `lang="en"`, responsive viewport, one H1, labelled controls, and native input types are present.

Risks and fixes:

- Remove global `body { overflow: hidden; }` from public content templates; allow normal document scrolling.
- Use semantic navigation and real anchors, not generic clickable containers.
- Ensure visible focus states, keyboard order, 44×44 CSS-pixel touch targets, and WCAG AA contrast.
- Associate every input with a persistent visible `<label>`; placeholders are supplemental only.
- Set specific autocomplete tokens (`username`, `email`, or `off` where genuinely appropriate), not generic `autocomplete="on"`.
- Provide skip navigation and a unique page `<main>`.
- Test 320 px width, 200% zoom, landscape, reduced motion, and screen readers.

## Public content strategy

NodeZero needs a public entity and topic footprint before editorial volume. Start with durable product and trust pages, then publish focused content clusters tied to customer problems.

### Recommended sequence

1. **Positioning foundation:** Homepage, product/how-it-works, audiences/use cases, about, security/privacy/trust, docs/developer overview, contact.
2. **Decision-stage proof:** Case studies, architecture/explainer pages, comparisons/alternatives (fact-based), implementation guides, FAQs, and transparent pricing or a clear sales path if applicable.
3. **Topic clusters:** One pillar per verified product category, supported by problem/solution guides, technical tutorials, terminology pages, and original research.
4. **Entity reinforcement:** Consistent organization name, logo, description, and linked official profiles; author pages with real credentials; dated and maintained content.

### Editorial requirements

- Assign one primary intent and query family per page; avoid near-duplicate doorway pages.
- Demonstrate first-hand expertise with screenshots, benchmarks, examples, methodology, and named authors/reviewers.
- Include publication and materially updated dates; review high-value pages quarterly.
- Link supporting articles to a pillar and to the next logical conversion step.
- Measure qualified organic visits, activation/demo conversion, assisted pipeline, branded/non-branded mix, indexed canonical URLs, and CWV pass rate—not raw page count.

## Release plan

### Phase 0 — Emergency correction (same release)

- Remove production → staging routing.
- Make staging `noindex, nofollow, noarchive` and exclude it from all sitemaps.
- Correct production canonical generation.
- Publish valid robots and sitemap endpoints.
- Add automated production smoke tests for hostname, canonical, status, title, description, robots, sitemap MIME/type, and absence of staging strings.

### Phase 1 — Indexable public foundation

- Launch SSR/SSG homepage and core public pages.
- Add semantic navigation/footer, unique metadata, structured data, and internal links.
- Separate sign-in/application code from public bundles and routes.
- Establish Lighthouse CI and accessibility checks.

### Phase 2 — Organic growth

- Publish decision-stage pages and initial topic clusters.
- Add Search Console/Bing reporting, log-based crawl monitoring, and content decay reviews.
- Iterate using impressions, non-brand query coverage, qualified conversions, crawl efficiency, and CWV field data.

## Engineering acceptance checklist

- [ ] Apex and `www` converge with one 301 hop to the chosen production hostname.
- [ ] No production response, canonical, asset reference, or structured-data URL contains `staging.nodezero.social`.
- [ ] Staging and authenticated/private pages return `noindex` via header or meta.
- [ ] Every indexable URL returns 200, is self-canonical, and has unique title/H1/description.
- [ ] `/robots.txt` returns 200 `text/plain` and declares the production sitemap.
- [ ] `/sitemap.xml` returns valid XML and includes only canonical 200-status indexable URLs.
- [ ] Core page copy and links exist in initial HTML with JavaScript disabled.
- [ ] Homepage has crawlable header/footer links and zero orphaned priority pages.
- [ ] JSON-LD validates and exactly matches visible content.
- [ ] Mobile Lighthouse CI thresholds pass on every public template; no serious/critical accessibility findings.
- [ ] Search Console reports the submitted sitemap as processed and representative URLs as indexed with the intended canonical.

## Suggested automated tests

For each production deployment, assert:

1. Host redirect matrix and maximum redirect count.
2. Status, content type, canonical, robots directives, title, H1, and description for representative routes.
3. No staging/internal hostnames in production HTML, headers, sitemap, manifest, or JSON-LD.
4. Robots and sitemap schema/URL validation.
5. Rendered and no-JS HTML both contain primary copy and navigation.
6. Internal links resolve without 4xx/5xx or redirect chains.
7. Structured data validation.
8. Lighthouse CI budgets and axe-core serious/critical issue count.

## Audit limitations

This was an unauthenticated outside-in audit of the public web experience on the audit date. Google Search Console, Bing Webmaster Tools, CDN/server logs, analytics, CrUX account data, deployment configuration, and source code were not available. Indexation observations therefore use public search and live response/rendering behavior; performance recommendations are architecture- and indicator-based rather than a claim of measured field CWV. Re-run the crawl and CWV tests immediately after the P0 release.
