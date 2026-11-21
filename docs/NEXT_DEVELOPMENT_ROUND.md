# Village Vibe: next development round

Prepared 2026-11-21 against `almost` at `f2eb8e4be39c2d532d1e08d56e0c24d53368d4a2`.

## Starting point

PRs #3–#21 are merged into `almost`. The owner approved #11's village policy: content needs a valid tribe association or trusted promotion; arbitrary self-applied village tags do not grant visibility. The combined source passes type checking, lint, all 34 existing tests, and the production build. GitHub's merged-branch Test run also passed: <https://github.com/ERP-FTW/village_vibe/actions/runs/44946522181>.

#22 remains draft. Its proposed push-to-`almost` deployment trigger has not been merged. No deployment was performed. Existing deployment configuration was preserved.

This is an implementation handoff, not another full audit. The remaining code paths below were inspected after integration. Local tests and CI do not establish live-relay interoperability.

## Working directions

Start from current `origin/almost`, preserving any newer work. Deliver one small PR per numbered item. Refresh from `almost` before final verification; preserve both sides of overlapping changes. The preceding integration needed only import conflict resolutions, and another worker was updating the same branches during merging.

For each PR, describe the concrete failure, the resulting behavior, and verification. Add focused regression coverage for the failure paths changed, using the existing Vitest/TestApp setup. Run `npm ci` and `npm test`. Avoid broad refactors, new infrastructure, and unrelated UI redesign. Review and merge each finished change independently; do not make this a new long stack. Keep schemas backward compatible unless the PR explicitly documents its migration.

## 1. Make privacy boundaries accurate before inviting testers

**Evidence:** `src/hooks/useEvents.ts:387–442` publishes event title, time, place, description, and invitee pubkeys as ordinary public Nostr fields, even when `visibility` is `private`. `src/components/tribes/CreateTribeDialog.tsx:83–100` publishes a public tribe definition with a `private` tag. Filtering discovery in this app does not encrypt those records. The separate private-details DM is encrypted.

**Smallest useful change:** describe tribe discovery settings as listed/unlisted, and event visibility as an app display/invitation rule. At the point of publication, plainly identify which fields remain public. Keep precise location and confidential instructions in the encrypted-details path; check that they never spill into public content or tags. Align creation, editing, About, and NIP documentation. Preserve existing tags so older records still load.

**Verify:** inspect a signed fixture for a restricted event and an unlisted tribe; the UI explains every public field. A confidential marker in private details/exact location appears only in encrypted messages. A raw relay reader must not be represented as unable to see the public event/tribe metadata.

**Scope limit:** do not design encrypted groups or change the tribe protocol in this PR. Genuine confidential group content is a separate design decision.

## 2. Recover partial message and invitation delivery

**Evidence:** `src/hooks/useSendDirectMessage.ts:30–42` converts inbox-list query failure into an empty list and silently ignores failure of the sender's history copy. `src/hooks/useEvents.ts:456–484` returns only a failed-invite count. `src/components/events/CreateEventDialog.tsx:546–574` then closes and clears the form even if some invitations failed.

**Smallest useful change:** return explicit recipient-delivery and sender-history outcomes. Distinguish a successful lookup with no advertised inbox from a lookup failure. Preserve the published event ID, failed recipients, and private-details draft so the user can retry only missing deliveries. Retain the existing signed wrap for retry while the page remains open; retrying the sender copy must not resend to the recipient. Keep a sent message visible when recipient delivery succeeded but the sender copy failed, with an accurate recovery action.

**Verify:** recipient accepts/sender rejects; inbox-list lookup times out; one of three event invitations fails; retry succeeds. No duplicate event is created, successful recipients are not sent another invitation, failed details remain recoverable, and success wording identifies what actually completed.

**Scope limit:** no generalized job queue or plaintext persistent outbox. Any durable retry storage must preserve confidentiality; a session-scoped recovery state is an acceptable first increment.

## 3. Preserve inbox pages and expose incomplete history

**Evidence:** `src/hooks/useDirectMessages.ts:46–63` discards a relay's earlier successful pages if a later page or the extra history request fails. Its cursor subtracts one second from the oldest result, which can skip additional messages sharing that boundary timestamp. Five recent pages and one older page are bounded reads, not a guarantee of complete history.

**Smallest useful change:** retain successful pages on later transport failure, while propagating explicit caller cancellation. Track completion/cursor state per relay. Handle equal-timestamp boundaries with deduplication and bounded progress; report truncation when a relay limit prevents completeness. Provide a bounded retry/load-older path instead of silently presenting a capped history as complete. Keep valid messages when another protocol or relay is unavailable.

**Verify:** page one succeeds and page two fails; recent pages succeed and old-history retrieval fails; more than 300 wraps share a timestamp; more than five pages exist; relays have unequal histories; caller cancels. Successful messages stay visible, duplicates are removed by ID, limits are explicit, and retries terminate.

**Scope limit:** retain the current per-relay architecture. No background indexing service or unlimited history scan.

## 4. Make check-in claims match the implemented behavior

**Evidence:** `src/components/events/AttendeeCheckIn.tsx:141–175` accepts any 13-digit code and publishes a user-signed check-in. `src/hooks/useEvents.ts` validates required attendance tags, not an organizer-issued challenge. `src/components/events/EventCheckIn.tsx:142–146` still promises verification, automatic badges, and security from rotating codes.

**Smallest useful change:** consistently label attendance as self-reported and remove unsupported verification/automatic-badge claims. Preserve legacy reads, but do not interpret `verified_at` or a well-shaped nonce as proof of attendance. Keep both host and attendee screens consistent with the README's existing self-reported description.

**Verify:** an arbitrary 13-digit submission cannot produce a verified-attendee badge or verified status. Both screens describe the same trust level; existing attendance remains readable. If the QR remains, its limited purpose is clear.

**Scope limit:** no new challenge/response protocol or badge issuance system. Organizer-attested attendance can be a later, separately specified feature.

## 5. Prepare a repeatable live-test release

**Footholds:** draft #22, `.github/workflows/deploy.yml`, `.github/workflows/test.yml`, `vite.config.ts`, `src/AppRouter.tsx`, and share-link helpers. The existing workflow targets `main`, Vite has no deployment base setting, and `BrowserRouter` has no basename. Changing the branch trigger alone does not resolve project-subpath hosting.

**Smallest useful change:** prepare a manual test-deployment path for a specific reviewed commit. Keep automatic production deployment disabled for this testing round. Choose the actual host and root/subpath before enabling deployment. Set asset base, router base, share/QR URL generation, and SPA fallback consistently for that target. Run the complete checks before uploading the artifact. Include a small build-info artifact containing the source commit so the deployed site can be compared with GitHub.

**Verify before deployment:** root URL and direct reloads of tribe, event, story, profile/NIP-19, hashtag, and chat routes; assets under the chosen base; mobile navigation; the build-info commit matches the tested commit. Retain the previous deployment/version reference for rollback.

**Live test after the target is selected:** use dedicated test identities and clearly marked test content. Exercise member-created tribe content, event/RSVP/check-in, service response, story, trusted promotion/hide, and two-way encrypted DMs. Force a relay failure: drafts survive and no premature success appears. Verify a published item from a second browser/account and, for DMs, a compatible independent client. Record relay URLs, event IDs, browser/signer, source commit, and results; keep message plaintext and private credentials out of logs. Do not publish test content or deploy as part of preparing this PR.

## Next after those: older promoted content and migration

`src/lib/villageFeed.ts:126` still discovers promotions through the latest 200 labels globally. Fetching labels for known candidates protects those candidates, but cannot discover an older promoted item that was never a candidate. Add indexed village scope to newly published promotion labels, bounded legacy discovery, and an explicit history/pagination path. Verify an older promoted item beyond 200 unrelated labels, a relay rejecting multi-letter filters, and unchanged moderator-authority checks. Document how authors upgrade old tags without moderators re-signing their content. Do not claim complete historical discovery from a fixed recent window.

## Defer

Keep event discussion migration, AI prompt-file deduplication, broader UI polish, and further bundle tuning outside this round. They should not delay exercising the repaired core flows on the test site. Do not treat `AUDIT.md`'s original findings table as current status; its line references describe the original `3433ddc` snapshot.
