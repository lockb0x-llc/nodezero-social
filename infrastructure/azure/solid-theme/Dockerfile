FROM docker.io/solidproject/community-server:7.1.9

# Package artifacts produced by scripts/azure/build-solid-themed-image.sh
COPY solid-nodezero-auth-ui.tgz /tmp/solid-nodezero-auth-ui.tgz
COPY css-stellar-auth.tgz /tmp/css-stellar-auth.tgz

# NodeZero global skin applied to all identity surfaces, including consent pages.
COPY templates/main.html.ejs /community-server/templates/main.html.ejs
COPY styles/nodezero-theme.css /community-server/templates/styles/nodezero-theme.css

# Custom CSS config that extends file.json with the Stellar auth plugin.
COPY css-config/nodezero.json /community-server/config/nodezero.json

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

# Install the Stellar auth plugin inside the community-server package directory
# so Components.js can resolve it by npm package name (lsd:module discovery).
# Also symlink the CSS root as @solid/community-server in node_modules so
# the plugin can `require('@solid/community-server')` correctly.
# Patch the CSS context to add StellarLoginHandler as a known bare term so
# @type: "StellarLoginHandler" resolves without a custom nzsa: prefix.
RUN set -eux; \
  cd /community-server; \
  npm install /tmp/css-stellar-auth.tgz >/dev/null 2>&1; \
  rm -f /tmp/css-stellar-auth.tgz; \
  ln -sfn /community-server /community-server/node_modules/@solid/community-server; \
  node -e " \
    const fs=require('fs'); \
    const CTX='/community-server/node_modules/@solid/community-server/dist/components/context.jsonld'; \
    const c=JSON.parse(fs.readFileSync(CTX,'utf8')); \
    const ctx=Array.isArray(c['@context'])?c['@context']:[c['@context']]; \
    const obj=ctx.find(x=>typeof x==='object')||{}; \
    obj['StellarLoginHandler']='https://linkedsoftwaredependencies.org/bundles/npm/@nodezero/css-stellar-auth/0.1.0/components/StellarLoginHandler'; \
    obj['StellarLoginHandler_accountStore']='https://linkedsoftwaredependencies.org/bundles/npm/@nodezero/css-stellar-auth/0.1.0/components/StellarLoginHandler_accountStore'; \
    obj['StellarLoginHandler_cookieStore']='https://linkedsoftwaredependencies.org/bundles/npm/@nodezero/css-stellar-auth/0.1.0/components/StellarLoginHandler_cookieStore'; \
    obj['StellarLoginHandler_webIdStore']='https://linkedsoftwaredependencies.org/bundles/npm/@nodezero/css-stellar-auth/0.1.0/components/StellarLoginHandler_webIdStore'; \
    if(!ctx.includes(obj)){ctx.push(obj);} \
    c['@context']=ctx; \
    fs.writeFileSync(CTX,JSON.stringify(c)); \
    console.log('CSS context patched with StellarLoginHandler terms.'); \
  "

# Copy the stellar-login config directly into CSS's own config/ directory so it
# can be imported as css:config/stellar-login.json without any custom prefix resolution.
# Then patch file.json to import it.
RUN set -eux; \
  PLUGIN_STELLAR_CFG="/community-server/node_modules/@nodezero/css-stellar-auth/config/stellar-login.json"; \
  test -f "$PLUGIN_STELLAR_CFG"; \
  cp "$PLUGIN_STELLAR_CFG" /community-server/config/stellar-login.json; \
  node -e " \
    const fs = require('fs'); \
    const cfg = JSON.parse(fs.readFileSync('/community-server/config/file.json', 'utf8')); \
    if (!cfg.import.includes('css:config/stellar-login.json')) { \
      cfg.import.push('css:config/stellar-login.json'); \
    } \
    fs.writeFileSync('/community-server/config/file.json', JSON.stringify(cfg, null, 2)); \
    console.log('Patched file.json with stellar-login import.'); \
  "
