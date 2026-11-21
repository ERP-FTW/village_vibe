# Village Vibe: Code Audit (2026-11-21)

**Scope:** all app code under `src/` (about 29k lines, excluding `components/ui`), plus CI config, docs and dependencies.

**How this was checked:**
- I ran `npm ci`, `tsc --noEmit`, `eslint`, `vitest run` and `vite build`.
- I read Nostrify's `NPool` source, which explains most of the reliability problems.
- I reviewed the core myself: providers, relay layer and tribes.
- Three parallel reviews covered the rest: events, services/stories/villages, and profile/chat/auth/zaps.
- Every item marked **[C]** (critical) was re-checked against the code by hand.

Line numbers refer to commit `3433ddc`.

---

## Status (updated 2026-11-21)

**Fixed** on branch `claude/wizardly-ramanujan-bbqidj`: [PR #2](https://github.com/ERP-FTW/village_vibe/pull/2), merged after review, plus follow-up commits.

| Area | What changed |
|---|---|
| §1 CI | `npm test` passes: tsc, eslint, 34 tests, build. Deploy runs the tests first. `npm ci` everywhere; scripts no longer run `npm i`. |
| §2 Relay layer | `RelayPool`: returns 300 ms after the first relay completes with matches. Waits at most 2 s for a match after an empty answer. Errors only when no relay completed. Single 5 s budget, one retry. The health check probes only the selected relay, with no polling. |
| §3 Publishing | Mutations sign and publish before showing success, then refresh the affected queries. DMs are encrypted. Drafts are kept on failure. |
| §4a/b Tribe authority | Creator-only, read-latest-then-write tribe updates (`useUpdateTribe`). No more forks, lost approvals or duplicate members. `event_creator` role now works. Only moderator rejections count. |
| §4a Promotion | Labels only, unless the promoter is the author. |
| §4c Tribe feeds | Query the tribe's members instead of only the owner. No fallback to the owner's other tribes. |
| §4d Hide labels | Honoured in tribe feeds when issued by the tribe's moderators. |
| §5 Security/privacy | Plaintext admin DMs gone. Profile URLs restricted to http(s). NIP-58 badge issuer check. Private tribes hidden from Discover and from non-members' profile views. DM list crash fixed. Decrypted DMs cached. Zap requests fixed. `ProfileZapDialog` removed. |
| §6 Broken features | Share links/QR use the real kind and a valid naddr. QR route fixed and `?tab=` honoured. NIP-19 profile/note/naddr views. `/t/:tag`. Check-ins on 36959. Venue and summary display. Create-event focus bug. Local dates. Author-aware tribe names. |
| §7 UX | Mobile menu. Debug panels dev-only. Search filters locally. Preferences sync. Route code splitting: 801 KB main bundle, was 1.29 MB. 41 `console.log` calls removed. |
| §8 Dead code | Dead files, barrels and unused hooks removed. |

## Repair plan

Each audit item is a separate PR. PRs 01–07 form a stack that merges in order into `almost`. Each later PR is based on the branch named in "Base", so after its base merges it retargets automatically.

"Codex" marks the foundational PRs that get a requested Codex review (up to 5 fix rounds or until clean). Every other PR got Codex's automatic review when it was opened, and its findings were fixed the same way.

| # | Audit § | PR | Base | Scope | Review and state |
|---|---|---|---|---|---|
| 01 | §1–3 | #3 | `almost` | CI gate, `RelayPool` reads, publish-before-confirm (Codex) | Clean at R2. Ready |
| 02 | §4a–c | #4 | 01 | Tribe authority, membership writes, member content in tribe feeds (Codex) | Clean at R2. Ready |
| 03 | §4a | #5 | 02 | Promotion via labels, not re-signed copies | Finding superseded by 09. Ready |
| 04 | §6 | #6 | 03 | Share links, QR route, NIP-19 pages, event display | 2 findings fixed. Ready |
| 05 | §5 | #7 | 04 | Profile URLs, badge issuers, zaps, DM list and decryption | Clean. Ready |
| 06 | §7–8 | #8 | 05 | Mobile menu, synced preferences, code splitting, dev-only debug UI | Clean. Ready |
| 07 | §4d | #9 | 06 | Honour moderators' hide labels | 2 findings fixed. Ready |
| 08 | §4c | #10 | 07 | Indexed tag model: tribe `a` and village `t` tags on publish, dual read (Codex) | R1 finding fixed. Clean at R2, and again at R3 after upstream merges. Ready |
| 09 | §4d | #11 | 08 | Village moderation: trusted promotion labels, tribe association, featured from labels (Codex) | R1–R2 findings fixed, clean at R3. Ready (village policy change: self-tagged content now needs tribe association or a moderator's promotion; owner sign-off) |
| 10 | §6, §4d | #13 | 08 | Coordination integrity: trusted authors, per-person claims, distinct counts, roles tab, task status (Codex) | R1–R3 findings fixed, clean at R4. Ready |
| 11 | §5, §6 | #12 | 07 | RSVP and check-in integrity: no host-signed RSVPs, negation-aware detection, latest RSVP per person | Clean. Ready |
| 12 | §6 | #14 | 09 | Services: working responses, NIP-40 expiry, village slugs, main-feed preferences (Codex) | R1 findings fixed, clean at R2. Ready |
| 13 | §5 | #15 | 07 | DMs: NIP-17 send/read with NIP-04 fallback (Codex) | R1–R4 findings fixed, clean at R5. Ready |
| 14 | §6 | #16 | 07 | Story Markdown rendering | 1 finding fixed. Ready |
| 15 | §7 | #19 | 07 | No hard-coded coordinates; optional geohash `g` tag | 2 findings fixed. Ready |
| 16 | §7 | #18 | 07 | Batch per-card author and badge queries | 2 findings fixed. Ready |
| 17 | §8 | #20 | 12 | Consolidate moderation dialogs; `DownloadNIP` from NIP.md | Clean. Ready. Discussion → `CommentsSection` not done (changes the data model: owner decision) |
| 18 | §7 | #17 | 07 | Chat layout, URL sync and accessibility | 1 finding fixed. Ready |
| 19 | §9 | #21 | 07 | README, NIP.md coverage, package name, archived notes | Clean. Ready |
| 20 | §1 | #22 | 07 | Deploy workflow on the default branch `almost` | Draft: owner decision (deploy branch, Pages base path) |

Not verifiable here: this environment blocks WebSocket connections to relays. Relay and publish behaviour was verified with simulated relays and a headless-browser smoke test.

---

## Contents
1. [Build and CI health](#1-build-and-ci-health)
2. [Root cause of the slow or empty loads (the relay layer)](#2-root-cause-of-the-slow-or-empty-loads)
3. [Publishing reports success before it happens](#3-publishing-reports-success-before-it-happens)
4. [Data-model and authority bugs](#4-data-model-and-authority-bugs)
5. [Privacy and security](#5-privacy-and-security)
6. [Broken features and links](#6-broken-features-and-links)
7. [UX and smoothness](#7-ux-and-smoothness)
8. [Redundancy and dead code](#8-redundancy-and-dead-code)
9. [Docs and spec drift](#9-docs-and-spec-drift)
10. [Suggested order of work](#10-suggested-order-of-work)

---

## 1. Build and CI health

| Check | Result |
|---|---|
| `tsc --noEmit` | **Fails: 13 errors** in `EventCoordinationTabs.tsx` (4), `EventModerationDialog.tsx:121` (1), `TribeView.tsx` (7) and `TribesPage.tsx:68` (1) |
| `eslint` | **Fails: 32 errors.** 15 are `no-explicit-any`, in `EventCoordinationTabs.tsx` and the two Debug dialogs; 17 are unused imports or variables |
| `vitest run` | Passes: 34 tests in 6 files |
| `vite build` | Passes, but outputs a single **1.31 MB JS chunk** (377 KB gzipped) with no route-level code splitting |

**Conclusion:** `npm test` is red, so the GitHub "Test" workflow is failing on `main`.

**Other CI and repo issues:**
- **Broken code ships anyway.** `.github/workflows/deploy.yml` runs only `npm run build`, and Vite does not type-check. Deploys should depend on the test job.
- **The test workflow is not reproducible.** `.github/workflows/test.yml` runs `rm -rf node_modules package-lock.json && npm install`, so CI never tests the locked dependency tree. Use `npm ci`.
- **Every script mutates the lockfile.** `dev`, `build` and `test` all begin with `npm i`.
- **The 404 copy happens twice.** The deploy workflow repeats `cp dist/index.html dist/404.html`, which `npm run build` already does.
- **A leftover GitLab CI config from the template** (`.gitlab-ci.yml`) has a 1-minute timeout that `npm i` will exceed.
- **Possible GitHub Pages path problem (suspected).** There is no `base` in `vite.config.ts` and no `public/CNAME`. If Pages serves this as a project site (`/<repo>/`), every asset 404s. `public/_redirects` is Netlify-only.
- **The tests give false confidence.**
  - `src/hooks/useServiceModeration.test.ts` re-declares the validator it claims to test (`:136-148`), so it can never fail. The module it is named after has no consumers.
  - `useServices.test.ts` uses a `by` tag in its match fixture that production never writes, so it locks in a bug (§6).
- **Repo clutter.**
  - `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md` and `GEMINI.md` are byte-identical 42 KB copies of the template prompt.
  - Eight stale debug write-ups sit in the root: `CHANGES_SUMMARY`, `COORDINATION_*`, `EVENTS_DEBUG_GUIDE`, `EVENT_*`, `SERVICES_DEBUG`, `TROUBLESHOOTING`.
  - `package.json` still names the project `mkstack`, and the README is the template's.
- **Excessive logging.** There are 251 `console.*` calls in app code, many with emoji, firing on every query and render. One example is `validateEnhancedEvent`, which logs once per event per fetch.
- **tsconfig is loose:** `"strict": false, "noImplicitAny": false`.

---

## 2. Root cause of the slow or empty loads

The git history shows about 20 commits of trial and error around timeouts, retries, `staleTime`, cache busting and reverts. The underlying cause is how Nostrify 0.46's `NPool.query` behaves (`node_modules/@nostrify/nostrify/NPool.js`):

1. **It waits for EOSE from every routed relay.** `NostrProvider.tsx:36-67` routes every REQ to 3 or 4 relays, so each query is as slow as the slowest relay, or runs until its timeout.
2. **It never throws.** On abort or relay error it returns whatever partial results it has. As a result:
   - **A timeout looks like "nothing exists."** The empty result is cached as real data (`staleTime` 60 s, `gcTime: Infinity`, `App.tsx:24-33`).
   - **The retry settings never fire.** That covers the default `retry: 3` and the per-hook `retry`/`retryDelay` in `useTribeEvents` and `useEventRSVPs`.
   - **The `try/catch` "fallback strategies" are dead code.** This applies to `useVillageEvents`, `useVillageStories` and `useVillageServices`.
   - **Error states never show.** Lists display "No events yet" or "No services found" when the real problem is a timeout.
3. **Several hooks share one short budget across sequential queries.**
   - `useVillageEvents` (`useEvents.ts:299`) runs up to 6 queries one after another on one 1500 ms signal.
   - `useEvent` (`useEvents.ts:153`) and the village story and service hooks do the same.
   - Once the first query uses up the budget, every later query starts with an already-aborted signal and returns `[]`.
4. **`useTribe` overcorrects** (`useTribes.ts:61-126`).
   - It throws on empty results so that retries happen, with `retry: 5` and a 20 s timeout.
   - A missing or mistyped tribe therefore shows the loading card for up to about 2 minutes.
   - It creates two timeout signals and uses only the second, which is one of the lint errors.
5. **The relay health indicator is meaningless.**
   - `useRelayHealth` queries through the whole pool, not the primary relay. It can never return `'error'`, so the nav always shows a green "connected" icon.
   - It polls every 30 s, which flashes the "Syncing 1 source" pill (`BackgroundSyncIndicator`).
   - The text "All queries have 10s timeout + 3 retries" (`Navigation.tsx:119`) is false: actual timeouts range from 1.5 s to 20 s.
   - `RelayStatusIndicator` hard-codes a different relay list from the router.

**Fix (one place, with large payoff):**
- Write a small `queryFast(filters, {timeoutMs})` helper over `pool.req()`. It should return shortly after the *first* EOSE plus a short grace period (for example 300 ms).
- It should throw when the signal aborts and nothing came back.
- Give each query its own signal, and use one shared timeout constant of about 5 s.
- Measure relay health with `nostr.relay(url).query(...)` on the primary relay only, and drop the polling, or poll only while the menu is open.

---

## 3. Publishing reports success before it happens

**[C] `useMutation` is used to *build* events, not publish them.**
- In `useCreateEnhancedEvent` (`useEvents.ts:525-644`), all six coordination hooks (`useEventCoordination.ts:93-513`), and the create, label and promote hooks in `useServices.ts`, `useStories.ts` and `useEvents.ts`, the `mutationFn` only returns an unsigned object.
- The hook's own `onSuccess` invalidates queries **first**. Only then does the call site's `onSuccess` sign and publish (for example `CreateEventDialog.tsx:243-272`).
- Result: the refetch races ahead of the publish, stale data is cached as fresh, and the new item doesn't appear.
- `isPending` doesn't cover the signer prompt, so buttons re-enable and users submit twice.

**[C] There are 24 fire-and-forget `mutate()` calls with an immediate success toast.**
- Examples: `CreateTribeDialog.tsx:95-104`, `TribeAdminPanel.tsx:189-200`, `useTribesActions.ts:99-111`, `DMDialog.tsx:44-61`, `ChatView.tsx:53-66`, `EventRSVP.tsx:61-76`, `ProfileSettings.tsx:78-97`.
- The surrounding `try/catch` can never see a publish failure, because errors only reach `console.error` in `useNostrPublish.ts:35`.
- A DM that fails to send is cleared from the input and lost.

**Many publishes never invalidate the queries they affect:**
- `CreateTribeDialog`, `EditTribeDialog`, `VillageAssociationDialog` and `useJoinTribe` invalidate nothing. A new tribe doesn't appear in My Tribes, and edits don't show.
- RSVPs, check-ins and discussion posts never invalidate `event-rsvps`, `user-rsvp`, `event-attendance` or `event-discussion`.

**Fix:** one pattern everywhere. Sign and publish inside `mutationFn`, then `setQueryData` or invalidate in `onSuccess`. Call sites use `await mutateAsync()` and show an error toast on failure. `useNostrPublish` itself is fine; the misuse is around it.

---

## 4. Data-model and authority bugs

These are the most serious correctness problems. Several features look as if they work, but they write data that no one can see or that does the wrong thing.

### 4a. Republishing someone else's addressable event creates a copy

An addressable event's identity is `kind:pubkey:d`. If user B republishes user A's event, the result is a new event owned by B. The original is unchanged.

- **[C] Tribe changes by anyone other than the creator fork the tribe.**
  - `TribeView.tsx:161-163` gives moderators the Admin tab.
  - `TribeAdminPanel.tsx` lets them approve members by republishing kind 34550.
  - `TribeMembers.tsx:244-250` and `EditTribeDialog.tsx:49-53` let any `admin` role edit.
  - When the person acting isn't `tribe.pubkey`, they publish their own copy of the tribe. The approval or edit silently does nothing.
  - Because the copy p-tags every member, it then appears as a **duplicate tribe** in every member's My Tribes (`useMyTribes` queries `#p`).
- **[C] "Promote to village" re-signs the author's content under the moderator's key**, for services (`useServices.ts:408-419`), stories (`useStories.ts:436-447`) and events (`useEvents.ts:468-477`, which also hard-codes kind 31923).
  - Village feeds then show duplicates with the wrong author.
  - Zaps and DMs on the copy go to the moderator.
- **Fix:** only the tribe creator can update kind 34550.
  - Hide the admin editing UI for everyone else, or move membership and approvals to separate events (for example NIP-72 kind 4550 approvals).
  - Promotion should be a kind 1985 label only, never a republish.

### 4b. Tribe membership loses updates

- **Approvals overwrite each other.** `TribeAdminPanel.tsx:183-193` builds the new tag list from the in-memory `tribe` prop and doesn't invalidate `['tribe', id]` afterwards. Approving two requests in a row publishes the second without the first.
- **Toggling "event creator" duplicates members.** `TribeMembers.tsx:52-71` maps the member's existing `p` tag to `event_creator` *and* pushes a second `p` tag. That is why a "Clean duplicate members" button exists.
- **The `event_creator` role grants nothing.** `TribeView.tsx:157-161` lets only `admin` or `moderator` create events, yet the toast says "can now create events".
- **Every edit adds tags.** `EditTribeDialog.tsx:76-80` adds another `['d', …]` and `['t','tribe']` on each save, because its filter doesn't remove them first.
- **Fix:** before writing, re-fetch the latest kind 34550, then modify and publish it (read-modify-write). Write tags idempotently. Invalidate `['tribe', id]`.

### 4c. Tribe content is looked up by the owner's key and multi-letter tags

- **[C] Members' posts never appear in their tribe.** `useTribeEvents` (`useEvents.ts:80-86`), `useTribeServices` (`useServices.ts:54-76`) and `useTribeStories` (`useStories.ts:31-52`) query `authors: [tribeOwner]`.
  - Posts by members, and events by moderators, therefore never appear.
  - When a tribe has none of its own posts, services and stories **fall back to showing the owner's posts from other tribes**.
- **Content is linked to tribes and villages with multi-letter tags,** `['tribe', d]` and `['village', slug]`, which relays don't index.
  - `#village` filters appear in `useEvents.ts:313,320`, `useStories.ts:98,581`, `useServices.ts:161` and `VillagePage.tsx:623-625`. Results from these filters are never re-checked in the client.
  - The bare `d` value collides across tribes. `useTribeName` looks a tribe up by `#d` with no author, so anyone can spoof the name shown (`useTribes.ts:229-264`).
- **Promoted items are looked up by scanning the latest 200 events network-wide.**
  - Code: `useEvents.ts:386`, `useStories.ts:156-166`. The code comment says "We can't directly query by 'a' tag".
  - For kind 30023, this almost never finds them.
  - Instead, resolve them with `{kinds:[k], authors:[pk], '#d':[d]}` filters in a single request.
- **Fix:** tag content with `['a', '34550:<owner>:<d>']` and query `#a`. Use a single-letter tag for villages (for example `['t', 'village-<slug>']`).

### 4d. Moderation is not enforced

- **Promotion labels are trusted from anyone.** They are accepted from any author, and the label's `village` is never compared to the current page. An item promoted to village A appears in B and in the main feed.
  - Code: `useEvents.ts:368-404`, `useStories.ts:138-166`, `useServices.ts:201-228`.
- **Anyone can put content in village feeds without approval.** The main feed accepts any item that has a `village` tag, and any user can add one when creating a service.
- **"Hide from tribe" and "Feature" do nothing.** No feed reads `tribe-hidden` or `village-featured` labels; see the `// TODO` at `useServices.ts:98-100`.
  - Event labels are also written with `a = "undefined:pk:d"`, because the missing `eventKind` is the tsc error at `EventModerationDialog.tsx:121`.
  - "Featured stories" are just the first 6 stories (`VillagePage.tsx:117-119`).
- **Anyone can change an event's coordination data.** `useEventCoordination.ts:548-606` doesn't filter by author, so anyone can inject roles, items or tasks into any event, or change a task's status.
- **Tribe join rejections use kind 9022,** which NIP-29 defines as "leave request".

---

## 5. Privacy and security

- **[C] Plaintext "DMs" are published to public relays.** `useServiceMatching.ts:49-79` publishes kind 4 with plaintext content containing the admin's match suggestions. The match record itself (kind 34871) is built but never published, yet the toast says "Match has been recorded".
- **Private event details are never sent.** `useSendPrivateEventDetails` (`useEvents.ts:648-680`) builds plaintext kind 4 objects that nothing publishes. Separately, "private" events, tribes and visibility tags are cosmetic: everything sits on public relays.
- **Private tribes are shown publicly.** They appear in Discover (`usePublicTribes` doesn't filter them) and on any visitor's view of a profile (`ProfileView.tsx:229-270`).
- **DM problems:**
  - **Weak encryption, overclaimed.** DMs use NIP-04 only, yet the UI says "End-to-end encrypted" (`ChatView.tsx:115`, About page). There is no NIP-44 or NIP-17, so messages from modern clients don't appear.
  - **One stranger can break the inbox.** A single kind 4 event that tags you in its *second* `p` tag makes `reduce()` with no initial value throw (`useDirectMessages.ts:138-152`). The conversation list then permanently shows "No conversations yet". **[C]**
  - **Heavy re-decryption.** It re-decrypts up to 100 messages one by one every 5 s (`useDirectMessages.ts:48-66, 98`), which is a burden for extension and bunker signers.
- **ProfileSettings can wipe the user's profile.** It publishes kind 0 from 8 form fields only (`ProfileSettings.tsx:69-82`), dropping `lud06`, `bot` and any custom fields.
  - If the author query timed out, the form is blank and Save publishes a near-empty profile.
  - The template's `EditProfileForm` merges existing fields correctly, but it is unused.
- **Unsanitized profile link (suspected exploitable).** The `website` href is used as-is (`ProfileView.tsx:101-108`), so a `javascript:` URL is possible. nsec logins and NWC strings live in localStorage. Allow only `http:`/`https:`.
- **Badges can be forged and are shown as trust signals.** `useBadges.ts` never checks that the award's author matches the badge definition's author, and `ServiceCard` displays raw awards.
- **Event integrity holes:**
  - **Check-in verification verifies nothing.** Codes are generated in the browser, never stored, and any 13 digits are accepted (`EventCheckIn.tsx`, `AttendeeCheckIn.tsx`).
  - **"Add as attendee" fakes RSVPs.** It publishes RSVPs signed by the *host* on behalf of others (`EventDiscussionRSVP.tsx:241-262`).
- **The QR poster SVG is built from unescaped tribe names** (`qrGenerator.ts:53,72`). "Arts & Crafts" breaks the file, and markup can be injected.

---

## 6. Broken features and links

| Feature | Problem | Where |
|---|---|---|
| Tribe QR codes and posters | Link to `/tribes/<id>?tab=services`; the route is `/tribe/:id`, so it 404s | `qrGenerator.ts:18,81` |
| Event share links and QR codes | naddr hard-codes kind 31923, but new events are kind 36959 | `nostrLinks.ts:27-33`, `ShareButton.tsx:116` |
| Story share links | `naddr1${storyId}`, which is not valid bech32 | `StoryCard.tsx:178`, `StoryPage.tsx:265` |
| `@mentions`, comment author links | Land on `<div>Profile placeholder</div>` | `NIP19Page.tsx:22-34` |
| naddr for events and stories | Kinds 36959 and 30023 show "Unsupported event type" | `NIP19Page.tsx:40-48` |
| Hashtag links | Go to `/t/<tag>`, which has no route | `NoteContent.tsx:84-91` |
| Check-ins on new events | Written with `a=36959:…`, read back with `31923:…` | `AttendeeCheckIn.tsx:165` vs `useEvents.ts:242` |
| Event location | Published as `place`, displayed from `location`, so it never shows | `useEvents.ts:561` vs `EventCard.tsx:32`, `EventHeader.tsx:20` |
| Event summary | Collected in the form, never published | `CreateEventDialog.tsx:805-811` |
| Create-event type fields | Lose focus on every keystroke: `TypeSpecificFields` is a component defined inside render | `CreateEventDialog.tsx:479` |
| Service matches | Validator requires a `by` tag that is never written; matches are never shown | `useServices.ts:542-618` |
| Story bodies | Markdown shown as plain text; `@tailwindcss/typography` installed but not registered | `StoryPage.tsx:250`, `tailwind.config.ts:96` |
| Hide tribe and village preferences | Don't apply until reload: each `useLocalStorage` instance has its own state, and `hiddenTribes` is missing from the services query key | `useLocalStorage.ts`, `useServices.ts:141` |
| Tribe page | A failed background refetch replaces a loaded tribe with "Tribe not found", because `tribeError` is checked before `tribe` | `TribeView.tsx:113` |
| Tribe card hover prefetch | Writes `null` under the same key with a different query function, causing a "not found" flash | `TribeCard.tsx:55-72` |
| Browse Tribes page | Never looks up join status (one of the tsc errors), so pending requests still show "Join" | `TribesPage.tsx:68` |
| Join tribe | "Request sent!" toast appears before publishing; card status is never refreshed | `useTribesActions.ts:99-111` |
| RSVP detection in replies | "not going" is read as *going*; "can't wait!" as *declined* | `EventDiscussion.tsx:27-37` |
| Dates | `min` date uses the UTC day; due dates are parsed as UTC midnight and show one day early in the Americas | `CreateEventDialog.tsx:459`, `CreateActionDialog.tsx:77` |
| Roles tab | Groups by a `status` tag that never changes, so "Filled" never renders | `EventRolesTab.tsx:40-41` |
| Claims | Random d-tags, no withdraw, counted per event rather than per person, counts can go negative | `useEventCoordination.ts:158,284,586-596` |
| Task status | `useUpdateAction` exists but nothing calls it, so tasks can't be updated | `useEventCoordination.ts` |
| Zaps | `encodeURI` corrupts comments containing `&`, `#` or `+`; `ProfileZapDialog` ignores NWC/WebLN and hard-codes a relay | `useZaps.ts:232`, `ProfileZapDialog.tsx:91-103` |
| Chat deep links | `?with=` read only once and not validated | `ChatPage.tsx:14-23` |
| Service expiry | Writes a custom `expires` tag and never reads it; use NIP-40 `expiration` instead | `useServices.ts:344` |
| Village slugs | Normalized four different ways; `.replace('-', ' ')` only replaces the first hyphen | `CreateServiceDialog.tsx:154`, `VillageServices.tsx:111` |
| Main village feed | Services and events ignore the village selection; hard-coded `'mack-eastside'` fallback | `VillagePage.tsx:52-88` |

---

## 7. UX and smoothness

- **There is no mobile navigation.** Nav links are `hidden md:flex` with no menu button (`Navigation.tsx:39`). On a phone, logged-out visitors cannot reach Tribes, Village or About at all.
- **Debug tools are shown to all users:**
  - A Debug button in TribeEvents, fixed bottom-right, which overlaps the sync pill.
  - Two entry points to `DebugCoordinationDialog`.
  - `StoryDebug`, which runs 4 queries on every tribe view.
  - `ServiceDebug`, which causes a duplicate fetch.
  - `VillageDebugTool`, which is half of `VillagePage.tsx` (lines 464-945) and puts a fixed `w-96` panel over phones.
  - A "Copy Debug Info" toast and two verification queries after every event create.
  - `window.debugNaddr`, plus tag dumps logged on every `EventHeader` render.
- **Every search keystroke refetches.** Client-side filters like `search` are part of the query keys (`VillagePage.tsx:67-88`, `TribeStories`, `TribeServices`), so each keystroke fires up to about 10 sequential queries to 4 relays. With `gcTime: Infinity`, every typed prefix stays cached forever. Debounce, and filter with `useMemo`.
- **Lists make several requests per card (N+1).**
  - Each StoryCard or ServiceCard runs `useAuthor`, `useBadges` (2 queries), `useTribe`/`TribeName` and `useZaps`.
  - A 50-item village feed sends more than 200 REQs, each going to 4 relays.
  - Fix: batch authors, badges and zaps at list level and seed the cache.
- **There is no infinite scroll.** Every feed is capped at a fixed `limit`, and `react-intersection-observer` is installed but unused.
- **Errors look like empty states** throughout (see §2). Some loaders are plain text where a skeleton would fit (`AdminServicesPanel`, `EventCoordinationTabs`).
- **The tribe page doesn't fit on phones.** Its 6 tabs overflow, and the "Badges" tab only says "coming soon".
- **Chat layout:**
  - `scrollIntoView` scrolls the whole window on every message.
  - The chat area is a fixed `h-[600px]`.
  - On mobile, the conversation list is stacked above the chat, with no list/detail toggle.
  - Conversation rows are `div onClick`, which keyboards can't reach, and the send button has no label.
- **Profiles flash "Profile information is private" while privacy settings load.** If those settings fail to load, profiles fall back to showing everything (`ProfileView.tsx:34-36`).
- **Location data is hard-coded.** Coordinates are fixed to Seattle or Detroit (`useEvents.ts:562`, `CreateServiceDialog.tsx:80`, `TribeServices.tsx:30`), so distance filters are wrong everywhere else. They are also stored in `l`, which collides with NIP-32 labels; use `g` (geohash).
- **Full-page reloads.** `<a href>` is used for internal links in `ProfileView.tsx:143,262`, which reloads the SPA and loses the cache.
- **Stale titles.** Leftover "Tribes" page titles remain, and logged-out visitors to the home page get the "About" title.

---

## 8. Redundancy and dead code

**Duplicates to merge:**
- **Moderation:** `StoryModerationDialog`, `ServiceModerationDialog` and `EventModerationDialog` are each about 285 lines and differ by fewer than 30 lines. The label and promote hooks are also tripled.
- **Village feeds:** the three-strategy village fetch is copied 3 times (`useVillageServices`, `useVillageStories`, `useMultiVillageStories`).
- **Discussion:** `EventDiscussion`, `EventDiscussionForm` and `EventDiscussionList` re-implement `CommentsSection` (NIP-22). They also post kind 1 notes tagged `t:event`, which pollutes global hashtag feeds.
- **Zaps:** `ProfileZapDialog` duplicates `ZapDialog`, but worse. Use `<ZapDialog target={kind0 or service event}>`.
- **Spec copy:** `DownloadNIP.tsx` hard-codes a stale copy of NIP.md (it is missing kinds 38401-38409). Use `import nip from '/NIP.md?raw'`.
- **Small helpers:** the RSVP keyword detector exists twice, the "is past" check three times, and `getCategoryIcon`/`getCategoryColor` four to five times. `extractServiceData` is re-implemented in `useServiceMatching.ts`.

**Dead code to delete:**
- **Unused files:** `GlobalLoadingOverlay.tsx`, `RelayHealthBanner.tsx`, `layouts/AppLayout.tsx` (contains only commented-out code), `ClientGuide.tsx`, `events/EventDebug.tsx` (0 bytes), `utils/debugNaddr.ts`.
- **Unused hooks:**
  - `useServiceModeration.ts` (all of it).
  - `useRSVPReplies.ts`. This one is also dangerous: a `useEffect` auto-publishes signed RSVPs.
  - `useTribeMemberCount`, `useTribeJoinRequests` (whose rejection filter is wrong anyway), `extractTribeName`.
  - `useService`, `useServiceMatches`.
  - `useRoleClaims` and `useItemClaims` (empty stubs), `useEventRoles`, `useEventItems`.
  - `useTribeBadges`, `useEventBadgeAwards`.
- **Unused exports and calls:**
  - Three unused builder functions in `nostrLinks.ts`, which `ShareButton` re-implements inline anyway.
  - `extractEnhancedEventData`, `canUserSeePrivateEvent`, `ALERT_TYPES`.
  - The `usePublicTribes()` call inside `CreateEventDialog`, "for potential future use".
- **Debug barrels:** `components/services/index.ts` and `components/stories/index.ts` re-export the debug components.

---

## 9. Docs and spec drift

- **README points to a spec that isn't there.** `README.md` says kinds 38857, 30627 and 34871 are specified in NIP.md, but **NIP.md has no services section at all.**
- **NIP.md is missing several things the code uses:**
  - Tribe usage: kind 34550 with role-bearing `p` tags.
  - The 9021/9022 join flow.
  - Kind 2073 check-ins.
  - Kind 30078 `profile-privacy`.
  - RSVPs (31925) that point at 36959 events.
- **NIP.md contradicts the code:**
  - It says event content is limited to 500 characters; the code allows 2000.
  - It calls `tribe`, `village` and `etype` "indexed", but multi-letter tags aren't indexed.
  - It says promotion is "by tribe admins"; the code accepts anyone.
  - The label `a` coordinate format differs.
  - It uses `cover` where NIP-23 uses `image`.
  - It lists 38408 and 38409 with no schema.
- **The NIP page is stale.** `NIPPage.tsx` says "Updated September 2025" and lists 3 kinds.

---

## 10. Suggested order of work

1. **Get CI green and stop shipping unchecked builds.** Fix the 13 tsc and 32 lint errors, make deploy depend on tests, switch to `npm ci`, and remove `npm i` from the scripts. *(Small)*
2. **Fix the query layer once (§2).** Add a `queryFast` helper (return after first EOSE plus a grace period, throw when aborted with no results), give each query its own signal and one timeout constant, use one combined request per hook, keep search out of query keys, and delete the relay-health polling. This addresses most of the "slow / doesn't load" complaints without any more timeout tweaking. *(Medium)*
3. **Make publishing honest (§3).** Publish inside `mutationFn`, have call sites use `mutateAsync`, toast on the real outcome, and invalidate. This fixes "my thing doesn't show up" and the double submits. *(Medium)*
4. **Fix the authority model (§4a, §4b).**
   - Only the creator republishes kind 34550, using read-modify-write.
   - Promotion is a label only.
   - Hide admin UI from roles that can't actually act.
   - Fix the `event_creator` gate. *(Medium)*
5. **Fix the tag model (§4c, §4d).** Use `a` tags for tribes and single-letter tags for villages, enforce moderation by checking label authors, and resolve promoted items by `authors` + `#d`. Update NIP.md at the same time. *(Large; this changes the data format, so plan a migration or accept that old content drops out)*
6. **Security and privacy quick wins.**
   - Remove the plaintext kind 4 sends.
   - Guard the DM `reduce`.
   - Make ProfileSettings merge into the existing profile (reuse `EditProfileForm`).
   - Sanitize metadata URLs.
   - Verify badge issuers.
   - Hide private tribes.
   - Escape the SVG. *(Small each)*
7. **Broken links.** Fix the QR route, the share-link kinds, the story naddr, the NIP19Page profile view and naddr redirects, and the hashtag route. *(Small)*
8. **Smoothness.** Add a mobile nav, remove the debug UI and console spam, batch per-card lookups, fix the `TypeSpecificFields` focus bug, and add route-level `lazy()` to split the 1.3 MB bundle. *(Small to medium)*
9. **Consolidate duplicates (§8).** One moderation dialog and hook, one village-feed hook, `CommentsSection` for discussions, `ZapDialog` for all zaps. Then delete the dead files and the four duplicate prompt files.
