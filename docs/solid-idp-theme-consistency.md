# Solid IdP Theme Consistency (NodeZero)

This runbook explains how to make Solid login screens visually consistent with NodeZero branding across desktop and mobile.

## Why the mismatch happens

NodeZero landing pages are rendered by the web app.
Solid sign-in credentials are collected on the Community Solid Server pages.
Those pages are currently served from the default Community Solid Server templates, which are white.

## What was already done

The web app now shows a branded transition overlay before redirecting to the Solid IdP. This keeps the handoff visually consistent.

## Full consistency fix (server-side theming)

1. Create a custom Community Solid Server image that overrides identity templates and CSS.
2. Point the Azure Container App to that image using the existing `cssImage` parameter in the Solid server IaC.
3. Redeploy the Solid server.

## Suggested file layout

Create a new folder outside runtime code, for example:

- `infrastructure/azure/solid-theme/`
  - `Dockerfile`
  - `templates/identity/login.html.ejs`
  - `templates/identity/password/login.html.ejs`
  - `templates/styles/custom.css`

## Example Dockerfile

```dockerfile
FROM docker.io/solidproject/community-server:7.1.9

# Override only the identity pages you want to brand.
COPY templates/identity/login.html.ejs /usr/lib/node_modules/@solid/community-server/templates/identity/login.html.ejs
COPY templates/identity/password/login.html.ejs /usr/lib/node_modules/@solid/community-server/templates/identity/password/login.html.ejs
COPY templates/styles/custom.css /usr/lib/node_modules/@solid/community-server/templates/styles/custom.css
```

## Minimal template tweak pattern

In your custom identity template, include `custom.css` and keep existing form bindings/variables intact.

```html
<link rel="stylesheet" href="/.well-known/css/styles/custom.css" />
```

## Azure rollout

1. Build and push your custom image (for example, to ACR).
2. Update deployment input so `cssImage` in `infrastructure/azure/solid-server.bicep` uses that image tag.
3. Redeploy the Solid server stack.
4. Validate login on:
   - `https://solid.nodezero.social/`
   - mobile Safari/Chrome
   - desktop browsers

## Validation checklist

- Login form uses NodeZero color palette and logo.
- Password reset and account pages share the same theme.
- No broken form actions or CSRF/session flows.
- OIDC redirects still return to NodeZero correctly.

## Notes

- Keep customizations minimal to reduce upgrade friction when updating Community Solid Server versions.
- Reapply and retest overrides after any Community Solid Server image version bump.
