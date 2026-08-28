The Solid Pod export is not failing inside the Pod stack—it is not implemented. The current “Export Recovery Bundle” feature exports wallet recovery material only and never reads the Pod.

Inspected `testnet` at commit `ffd3ff7d51b84882dda21488e6e5e99baed76c17`. No files were modified.

## Findings

1. Critical: the export contains no Solid Pod data

The trigger is in [settings.tsx](C:/Users/steven/Documents/Codex/2026-08-28/referenced-chatgpt-conversation-this-is-an/work/nodezero-social/packages/mobile-app/app/settings.tsx:497). It invokes `exportRecoveryBundle()` at [settings.tsx](C:/Users/steven/Documents/Codex/2026-08-28/referenced-chatgpt-conversation-this-is-an/work/nodezero-social/packages/mobile-app/app/settings.tsx:174).

That implementation only serializes:

- environment and Stellar network
- WebID
- Stellar public/private key
- lockb0x attestation
- locally stored pairing record

See [WalletContext.tsx](C:/Users/steven/Documents/Codex/2026-08-28/referenced-chatgpt-conversation-this-is-an/work/nodezero-social/packages/mobile-app/src/contexts/WalletContext.tsx:601).

It does not use `podUrl`, the authenticated Pod fetch function, `ProfileManager`, or any Solid dataset/container operation. Therefore it exports neither profile data nor other Pod resources.

Recommended fix: distinguish the features explicitly:

- “Export Identity Recovery Bundle” for the existing wallet-key JSON.
- “Export Solid Pod Data” for a new authenticated, recursive Pod export.
- Optionally provide a combined encrypted backup, but do not silently mix wallet secrets into a normal data export.

2. Critical: Pod traversal and archive serialization do not exist

There is no exporter that:

- starts at the authenticated Pod root
- requests LDP containers
- follows `ldp:contains`
- fetches RDF and binary resources
- preserves relative paths and content types
- records failed or inaccessible resources
- writes ZIP/TAR or another portable archive format

The mobile package also has no direct archive dependency such as JSZip/fflate and no archive schema or manifest. Its dependencies are shown in [package.json](C:/Users/steven/Documents/Codex/2026-08-28/referenced-chatgpt-conversation-this-is-an/work/nodezero-social/packages/mobile-app/package.json:1).

Recommended fix: implement an exporter service with:

- cycle-safe recursive container traversal
- bounded concurrency and resource/total-size limits
- exact byte preservation for non-RDF resources
- a versioned manifest containing URL, relative archive path, media type, ETag, size, and fetch status
- ZIP output with deterministic path mapping
- explicit treatment of ACL/ACP resources and inaccessible/private entries
- cancellation and progress reporting

3. High: the authenticated Pod/proxy path exists, but export bypasses it completely

The correct client access path is already available. `authFetch` rewrites Pod URLs through the provisioner proxy, refreshes the NodeZero session, and attaches its bearer token at [NodeZeroSessionContext.tsx](C:/Users/steven/Documents/Codex/2026-08-28/referenced-chatgpt-conversation-this-is-an/work/nodezero-social/packages/mobile-app/src/contexts/NodeZeroSessionContext.tsx:393).

The server then:

- validates the NodeZero session
- limits requests to the session’s Pod namespace
- retrieves stored CSS client credentials
- mints a DPoP-bound Solid token
- forwards the LDP operation to CSS

See [podProxy.ts](C:/Users/steven/Documents/Codex/2026-08-28/referenced-chatgpt-conversation-this-is-an/work/nodezero-social/packages/jss-provisioner/src/podProxy.ts:255) and its namespace enforcement at [podProxy.ts](C:/Users/steven/Documents/Codex/2026-08-28/referenced-chatgpt-conversation-this-is-an/work/nodezero-social/packages/jss-provisioner/src/podProxy.ts:131).

This path supports `GET` and `HEAD`, forwards useful Solid headers, and returns arbitrary response bytes. It should be usable for export without adding a privileged server-side dump endpoint.

Recommended fix: inject the session’s authenticated fetch into a dedicated Pod exporter and begin traversal from the canonical `podUrl`, not from an inferred WebID prefix.

4. High: native mobile does not produce a file

On native platforms, delivery calls:

```ts
Share.share({ title: fileName, message: json })
```

at [settings.tsx](C:/Users/steven/Documents/Codex/2026-08-28/referenced-chatgpt-conversation-this-is-an/work/nodezero-social/packages/mobile-app/app/settings.tsx:171).

This shares raw JSON as message text. It does not create or attach the named `.json` file. That is unsuitable for a potentially large Pod archive and can hit share-target message limits.

The project has no direct `expo-sharing` or document-picker dependency, and `expo-file-system` is only transitively present—not declared or used by this feature.

Recommended fix:

- Write the archive into the app cache/document directory.
- Share the resulting file URI using `expo-sharing`.
- Offer a platform document-picker/save destination where supported.
- Clean up temporary files only after the share/save operation completes.

5. High: delivery completion is reported prematurely

The native branch deliberately discards the `Share.share()` promise at [settings.tsx](C:/Users/steven/Documents/Codex/2026-08-28/referenced-chatgpt-conversation-this-is-an/work/nodezero-social/packages/mobile-app/app/settings.tsx:171). Consequently, `deliverBundle()` resolves immediately and the UI reports “Recovery bundle exported” at line 180 before sharing has succeeded.

Errors may become unhandled rejections, and user cancellation is indistinguishable from success.

Recommended fix: `await Share.share(...)`, inspect its result where supported, and return a delivery outcome such as `saved`, `shared`, or `cancelled`. Only display success for a completed action.

6. Medium: web cancellation is also reported as success

When Web Share raises `AbortError`, `deliverBundle()` simply returns at [settings.tsx](C:/Users/steven/Documents/Codex/2026-08-28/referenced-chatgpt-conversation-this-is-an/work/nodezero-social/packages/mobile-app/app/settings.tsx:131). The caller then sets “Recovery bundle exported.”

Recommended fix: propagate a cancellation result rather than treating it as successful delivery.

7. Medium: the web path copies the private key to the clipboard unnecessarily

After an anchor download is triggered, the code still attempts to copy the entire recovery JSON to the clipboard at [settings.tsx](C:/Users/steven/Documents/Codex/2026-08-28/referenced-chatgpt-conversation-this-is-an/work/nodezero-social/packages/mobile-app/app/settings.tsx:155).

Because this bundle contains the Stellar secret key, this unnecessarily places highly sensitive material in clipboard history even when the file download appeared to work.

Recommended fix: use clipboard only after a verified download/share failure and require a separate explicit confirmation.

8. Medium: the Blob URL is revoked immediately

The object URL is revoked directly after `anchor.click()` at [settings.tsx](C:/Users/steven/Documents/Codex/2026-08-28/referenced-chatgpt-conversation-this-is-an/work/nodezero-social/packages/mobile-app/app/settings.tsx:136). Some mobile/Safari download flows consume the URL asynchronously, so immediate revocation can produce intermittent failures.

Recommended fix: revoke it on a later event-loop turn or after a short deferred cleanup, and avoid claiming success merely because `.click()` returned.

9. Medium: restore only restores identity, not exported user data

The recovery parser accepts only environment, network, WebID, and wallet keys at [recoveryBundle.ts](C:/Users/steven/Documents/Codex/2026-08-28/referenced-chatgpt-conversation-this-is-an/work/nodezero-social/packages/mobile-app/src/wallet/recoveryBundle.ts:7). It returns a wallet identity at line 62.

The UI explicitly restricts recovery import to the web/PWA and rejects native mobile at [index.tsx](C:/Users/steven/Documents/Codex/2026-08-28/referenced-chatgpt-conversation-this-is-an/work/nodezero-social/packages/mobile-app/app/index.tsx:833).

Even after a genuine Pod archive exporter is added, there is currently no corresponding Pod restore/import pipeline.

Recommended fix: design export and restore together, including conflict policy, ACL handling, dry-run validation, version migration, partial failure reporting, and native file selection.

## Bottom line

The present feature was introduced as an identity recovery export, not a Pod export. The Pod proxy/authentication infrastructure is largely capable of supporting read-side export, but the repository is missing the actual Pod crawler, archive format, archive writer, native file delivery, and Pod restore path. The existing delivery code also has concrete success-reporting and private-key clipboard bugs.