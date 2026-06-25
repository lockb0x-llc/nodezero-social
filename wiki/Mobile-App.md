# Mobile App

The mobile app package hosts the main user experience via Expo Router.

## Primary routes

| Route | URL | Auth required | Unauthenticated message |
|---|---|---|---|
| Landing | `/` | No | Sign-in form |
| Feed | `/feed` | Yes | "Please sign in to view your feed." |
| Local Node | `/local` | Yes | "Sign in to join your Local Node." |
| Profile | `/profile` | Yes | "Please sign in to view your profile." |
| Settings | `/settings` | No (partial) | Shows pod/wallet/prefs with signed-out state |

## Landing page (`/`)

The landing page renders without authentication and includes:
- **Hero**: "NodeZero — Your data. Your rules. Your network."
- **Feature cards**: Data Sovereignty, Local Nodes, No Algorithms, Privacy First
- **Solid sign-in form**: IdP URL field pre-filled with `https://solidcommunity.net` + "Sign in with Solid Pod" button
- **Registration link**: "Don't have a Pod? Create one for free at solidcommunity.net"

### Auth validation behaviour (as of testnet commit 778c37f)
- Empty IdP URL: "An Identity Provider URL is required."
- Non-HTTPS IdP URL: "Identity Provider must use HTTPS (e.g. https://solidcommunity.net)."
- Valid HTTPS IdP: Redirects to IdP OIDC flow (solidcommunity.net login page)
- Login failure: "Login failed. Please check the Identity Provider URL and try again."

## Settings page (`/settings`)

Settings is partially accessible without authentication:

| Section | Content | Auth state |
|---|---|---|
| Solid Pod | WebID | "Not signed in" when unauthenticated |
| Content Preferences | NSFW content toggle | Always visible |
| Embedded Wallet | Stellar public key + network status | Provisioning on load |
| Data Management | "Export & Erase Local Cache" button | Always visible |
| Account | "Sign Out" button | Always visible |
| Version | "NodeZero.social v0.0.1" | Always visible |

## Contexts

- `WalletContext`: wallet lifecycle and registration.
- `SolidContext`: SOLID identity/session handling.
- `DiscoveryContext`: location/discovery state.

## Known issues and resolution status

| ID | Issue | Status | Fix |
|---|---|---|---|
| WR1 | Wallet provisioning silently fails on web — `expo-secure-store` calls `getValueWithKeyAsync` (native-only bridge method); Settings shows "Provisioning…" forever | **FIXED** in testnet commit 778c37f | `Platform.OS === 'web'` guard in `WalletContext.tsx` skips `SecureStore` on web, using in-memory fallback |
| AU2 | Empty IdP URL shows generic "Login failed" error | **FIXED** in testnet commit 778c37f | Client-side empty-URL check added before login call |
| AU3 | Non-HTTPS IdP not rejected client-side | **FIXED** in testnet commit 778c37f | Client-side `https://` prefix check added |
| X1 | Missing favicon (404 on `/favicon.ico`) | **Open** (J3, low priority) | Add `favicon.png` to Expo web config |
| J4 | Authenticated journeys not yet verified | **Pending** | Requires staging redeploy of 778c37f + Solid Pod login |

## Notes

- Staging profile and chain settings are guarded for environment coherence.
- SWA deployment support is wired for the web build path.

## Visual evidence

![Profile](../docs/screenshots/profile-sync-step1.png)
![Settings](../docs/screenshots/settings-env-logout-export-step1.png)
![Wallet](../docs/screenshots/wallet-creation-step1.png)

- Video: ../docs/videos/profile-and-settings.webm

## Primary routes

- `packages/mobile-app/app/index.tsx`
- `packages/mobile-app/app/feed.tsx`
- `packages/mobile-app/app/local.tsx`
- `packages/mobile-app/app/profile.tsx`
- `packages/mobile-app/app/settings.tsx`

## Contexts

- `WalletContext`: wallet lifecycle and registration.
- `SolidContext`: SOLID identity/session handling.
- `DiscoveryContext`: location/discovery state.

## Notes

- Staging profile and chain settings are guarded for environment coherence.
- SWA deployment support is wired for the web build path.

## Visual evidence

![Profile](../docs/screenshots/profile-sync-step1.png)
![Settings](../docs/screenshots/settings-env-logout-export-step1.png)
![Wallet](../docs/screenshots/wallet-creation-step1.png)

- Video: ../docs/videos/profile-and-settings.webm
