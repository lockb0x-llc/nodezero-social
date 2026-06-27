# L7 QA Evidence — UX Phase 1+2

Date: 2026-06-27
Branch: feat/ux-phase1 (merged into L7 branch via rebase)

## J1: Backpack WebACL
Status: PASS
Evidence:
- `updateWebACL` called in `togglePermission` — `backpack.tsx` line 38: `manager.updateWebACL(CONTAINER_PATHS[key], newValue)`
- `ActivityIndicator` renders while update is in-flight — lines 80–82, 98–100, 116–118: each card conditionally renders `<ActivityIndicator size="small" color="#3B82F6" />` when `updating === '<key>'`
- Error caught with `Alert.alert` — lines 41–44: `.catch(() => { setPermissions(prev => ...); Alert.alert('Error', 'Failed to update permissions'); })`

## J2: Docustream Pod
Status: PASS
Evidence:
- `DocustreamManager.listActivities(podRoot)` called in `useEffect` — `docustream.tsx` lines 77–90: effect guards on `isLoggedIn && webId`, constructs `podRoot`, creates `DocustreamManager(session)` and calls `.listActivities(podRoot)`
- Items state set from result — line 86: `if (podItems.length > 0) setItems(podItems);`
- Mock fallback present — line 73: `useState<StreamItem[]>(MOCK_DOCUSTREAM)` initialises state with mock; `.catch(() => { /* Keep mock fallback on error */ })` leaves mock intact on failure

## J3: Compose P2P Routing
Status: PASS
Evidence:
- `audience=local` → P2PChannel — `compose.tsx` lines 40–55: iterates `surroundingNodes`, constructs `new P2PChannel({ localWebId, remoteWebId })`, calls `ch.connect?.()`
- `audience=foaf` → Pod /outbox/ PUT — lines 55–75: uses `SocialGraph.listConnections`, then `session.fetch(podRoot + 'outbox/...' , { method: 'PUT', ... })` for each connection
- `audience=verified` → verifyPoH guard + Pod write — lines 75–100: calls `verifyPoH(recipientWebId)`, skips unverified recipients, writes to `/outbox/` only for verified connections
- `sending` disables Post button and shows ActivityIndicator — lines 130–140 (header): `disabled={!postText.trim() || sending}` and `{sending ? <ActivityIndicator size="small" color="#FFF" /> : <Text ...>Post</Text>}`

## J4: Semantic Overlap Profile
Status: PASS
Evidence:
- `findSemanticOverlap(peerWebId)` called when `peerWebId` route param is present — `profile.tsx` lines 59–68: `useEffect` guards `if (!peerWebId || !isLoggedIn) return`, then calls `new SocialGraph(session).findSemanticOverlap(peerWebId)`
- `sharedThreads` state set from result — line 63: `if (threads.length > 0) setSharedThreads(threads)`
- Shared Threads card renders conditionally on `sharedThreads.length > 0` — lines 205–219: `{sharedThreads.length > 0 && (<View style={styles.sharedThreadsCard}>...</View>)}`

## solid-pod-sync tsc --noEmit
Status: FAIL (exit code 2, 7 errors in 3 files)
Details:
- `src/NsfwScanner.ts:87` — TS2552: Cannot find name 'URL' (shadowed by parameter `url`; pre-existing naming collision)
- `src/ProfileManager.ts:29` — TS2307: Cannot find module '@inrupt/solid-client' (missing installed type declarations)
- `src/ProfileManager.ts:36` — TS7017: `globalThis` implicit any
- `src/SocialGraph.ts:26` — TS2307: Cannot find module '@inrupt/solid-client'
- `src/SocialGraph.ts:32` — TS7017: `globalThis` implicit any
- `src/SocialGraph.ts:92` — TS7006: Parameter 'webId' implicit any
- `src/SocialGraph.ts:154` — TS7006: Parameter 'u' implicit any

Note: All 7 errors are in pre-existing `solid-pod-sync` source files (NsfwScanner, ProfileManager, SocialGraph), not in the new UX Phase 1+2 screens. The root cause is `@inrupt/solid-client` type declarations not installed in this worktree environment and `strict` implicit-any errors in existing code. These must be resolved before feat/ux-phase1 can be merged to testnet.

## Overall
Result: FAIL (4/4 code review PASS, tsc FAIL) — solid-pod-sync has 7 pre-existing type errors requiring resolution before merge
