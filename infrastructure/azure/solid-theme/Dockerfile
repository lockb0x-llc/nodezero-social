FROM docker.io/solidproject/community-server:7.1.9

# Package artifact produced by scripts/azure/build-solid-themed-image.sh
COPY solid-nodezero-auth-ui.tgz /tmp/solid-nodezero-auth-ui.tgz

# NodeZero global skin applied to all identity surfaces, including consent pages.
COPY templates/main.html.ejs /community-server/templates/main.html.ejs
COPY styles/nodezero-theme.css /community-server/templates/styles/nodezero-theme.css

RUN set -eux; \
  mkdir -p /tmp/nz-auth-ui; \
  cd /tmp/nz-auth-ui; \
  npm init -y >/dev/null 2>&1; \
  npm install /tmp/solid-nodezero-auth-ui.tgz >/dev/null 2>&1; \
  PKG_DIR="$(npm root)/@nodezero/solid-nodezero-auth-ui"; \
  test -f "$PKG_DIR/templates/identity/login.html.ejs"; \
  test -f "$PKG_DIR/templates/identity/forgot-password.html.ejs"; \
  test -f "$PKG_DIR/templates/identity/oidc/consent.html.ejs"; \
  test -f "$PKG_DIR/assets/base-tailwind.css"; \
  cp "$PKG_DIR/assets/base-tailwind.css" /community-server/templates/styles/nodezero-base-tailwind.css; \
  cp "$PKG_DIR/templates/identity/login.html.ejs" /community-server/templates/identity/password/login.html.ejs; \
  cp "$PKG_DIR/templates/identity/forgot-password.html.ejs" /community-server/templates/identity/password/forgot.html.ejs; \
  cp "$PKG_DIR/templates/identity/oidc/consent.html.ejs" /community-server/templates/identity/oidc/consent.html.ejs; \
  if [ -f "$PKG_DIR/templates/identity/register.html.ejs" ]; then cp "$PKG_DIR/templates/identity/register.html.ejs" /community-server/templates/identity/password/register.html.ejs; fi; \
  rm -rf /tmp/nz-auth-ui /tmp/solid-nodezero-auth-ui.tgz
