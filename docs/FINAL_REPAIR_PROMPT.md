# Final functional repair prompt for Claude

Work in `ERP-FTW/village_vibe`, starting from the current `origin/almost`. The verified baseline is `51a6f054ea46a76f85baf551ca20eb1b9c894285`: PRs #3–#21 and #23–#28 are merged, #22 is closed, and the combined code passes type checking, lint, 95 tests in 18 files, and build. Fetch first and preserve newer work.

Finish the remaining concrete functional gaps below so the app is ready for a live test. Implement the repairs; do not return another audit or implementation plan. Keep the work in four small PRs, using the existing components, hooks, protocols, and test setup. The first two are related; land the visibility behavior before exposing it in the form. Base independent PRs on `almost`, refresh overlaps, and test the final combination.

The defaults below are intentional decisions for this round. Proceed without asking additional product-policy questions. If an unrelated ambiguity appears, finish the independent work and report that narrow issue once. Do not invent a new service, queue, encryption scheme, reputation system, or deployment framework.

**Badges are on hold by the user's instruction.** Exclude badge issuance, badge validation/display changes, badge-based service filtering, and badge-related copy or tab cleanup from this round. Do not implement or rename the inert “Trusted only” service filter as part of this work. Record those known gaps as deferred; they do not block the event repairs or preparation for live testing. Preserve existing badge behavior.

## 1. Apply event visibility consistently inside the app

**Confirmed gap:** `src/hooks/useEvents.ts:682` applies visibility only if `filters.visibility` is supplied. Normal tribe/village calls do not supply it. `useEvent` and `src/components/events/EventView.tsx` also display an event without a viewer-eligibility check. Adding visibility controls alone would expose a setting the app does not consistently honor.

Use one small, tested eligibility helper, separate from optional search/type/date filters. Apply it to tribe and village event lists and every event-detail entry point, including NIP-19 links. Use existing tribe membership helpers and indexed author-qualified tribe coordinates; do not infer authority from an ambiguous legacy slug.

Use these app-display rules:

- `public`, or a missing visibility tag: visible to everyone.
- `tribe-only`: visible to the organizer and current members of the referenced tribe, including its owner/admins/moderators.
- `private`: visible to the organizer and explicitly invited pubkeys. Being a moderator alone does not grant an invitation.

These rules control Village Vibe's presentation, not relay confidentiality. The underlying listing and invitee tags remain public. Keep that disclosure accurate. For a restricted event, unresolved membership must not briefly render it as public; show a loading or lookup-error state as appropriate. Keep public events usable when an unrelated membership lookup fails.

Include the viewer and relevant membership version in the affected cache keys, or provide equivalent invalidation. Login, logout, account switching, and membership changes must update eligibility. Ensure the local search `select` functions do not accidentally discard viewer context or re-expose filtered events.

**Acceptance:** tests cover logged-out visitors, organizer, member, invited nonmember, unrelated user, ambiguous legacy tribe references, account switches, and membership lookup failure. Tribe/village lists and direct/NIP-19 routes agree. No change to the approved village moderation authority policy.

## 2. Finish the event invitation form and exercise recovery through the real UI

**Confirmed gap:** `src/components/events/CreateEventDialog.tsx` has `visibility`, `invitees`, `privateDetails`, `exactLocation`, and `sendDMs` state, but renders no controls for them. Consequently the invitation and recovery code is unreachable from the form.

Add compact controls for public, tribe-members, and invited-people app visibility. Default to public. Explain beside the controls that the event listing and invitee identities are public on Nostr; only direct-message details are encrypted. Use clear labels rather than promising confidential events.

For invited-people events:

- Accept validated hex pubkeys, npub, and nprofile through existing NIP-19 utilities; normalize and deduplicate them. Reject malformed values before signing. Require at least one actual invitee.
- Expose the encrypted-details and exact-location inputs and the existing send-invitations choice. Keep public place/description visibly separate. Never copy confidential fields into public content, tags, logs, or persistent plaintext storage.
- Reuse `buildEnhancedEventTemplate`, `buildPrivateDetailsMessage`, `useSendPrivateEventDetails`, `useRetryInvitations`, and `InvitationRecovery`. Do not replace the working delivery/outbox core.
- Publish the event once. When some invitations fail, retain the same event ID, confidential draft, failed recipients, and signed deliveries. Retry only missing deliveries; never create another event or resend completed deliveries. Display recipient-delivery and sender-history outcomes accurately.

Remove the unused `usePublicTribes()` query at line 405 and unused form state such as `enableZaps`, `enableComments`, or `autoPromptStory` only after confirming no consumer exists. Do not add more features merely to make dead state useful.

**Acceptance:** a component-level test uses the actual form: select invited people, enter recipients/details, publish with one failed recipient, retry, and finish. Assert one event publication, correct recipient deduplication, no repeated successful send, no confidential marker in the public signed event, and preservation on signer/relay failure. Test the ordinary public-event path, keyboard focus, and mobile layout too. Demonstrating only the recovery panel in isolation is insufficient.

## 3. Repair event discussion and replies without losing existing conversations

**Confirmed gaps:** `EventDiscussionList.tsx` renders a reply-count icon but no reply composer. `useEventDiscussion.ts:90–96` requires more than one `e`/`E` tag to recognize a reply, which misses address-rooted replies with one parent `e`. The form publishes kind 1 notes with broad `event`/`discussion` hashtags. Existing shared comment components already provide a composer and NIP-22 publishing, but replacing the event reader outright would lose its legacy kind 1 history.

Reuse the shared comment UI/publisher where practical, with a small compatibility adapter for event discussion. Read existing kind 1 discussions and kind 1111 comments together, deduplicate by event ID, and preserve the event's stable address across revisions. Keep reply chains correctly attached to their direct parent. Add bounded traversal and ID deduplication so malformed relationships or excessive nesting cannot freeze rendering.

Use NIP-22 for new event comments/replies: uppercase tags identify the root scope, lowercase tags identify the immediate parent; preserve kind and author tags. Check the current specification, including addressable-parent revision references, rather than copying the current helper unchecked:
<https://github.com/nostr-protocol/nips/blob/master/22.md>.

Keep a compatible path for replies to legacy discussion notes. Do not rewrite or re-sign old users' comments. Remove the broad default hashtags from new discussion writes. Preserve the host's informal-RSVP view, but make the copy clear that saying “yes” in a comment does not publish an RSVP. Only the participant's actual RSVP action may do that.

Refresh the displayed discussion only after relay acceptance. Failed posts/replies retain their text and show an actionable error. Align the shared comment and event-discussion query keys/invalidations so a newly posted reply appears without a reload.

**Acceptance:** create a comment and reply through the rendered UI; reopen and see the same tree. Include a mixed legacy/NIP-22 fixture, an address-rooted reply with one parent `e`, nested replies, event replacement at the same address, malformed/duplicate relationships, and a failed publication. No duplicate top-level/reply rendering; no host-signed RSVP; no loss of legacy conversations.

## 4. Final functional verification and a clean handoff for live testing

Run a bounded walkthrough of the features touched and the established core: create tribe → join/approve → member story/service/event → RSVP/check-in → discussion/reply → service response → promotion/hide → DM failure/retry/history. Check both the actor and a second viewer with local fixtures. Confirm that each successful write has a reachable read/display path. Repair directly reproduced regressions in this scope in small commits; record unrelated enhancements without expanding the round.

Build and check routes/assets at both `/` and `/village_vibe/`. Preserve the manual-only workflow, source-commit build info, and rollback instructions from #27. Do not reintroduce automatic deployment. Prepare the first test release for the GitHub Pages project path `/village_vibe/`; actual publication and any Pages-settings changes remain a later instruction. No live test messages, zaps, or production data are to be published in this coding round.

Update `AUDIT.md`, `NIP.md`, `README.md`, and the prior handoff's status where needed so historical findings and completed rounds are not presented as current defects. State the current visibility behavior, comment compatibility, badge work deferred by the user, and any live checks not run. Leave AI instruction-file consolidation and further bundle tuning out of this round.

## Execution, review, and stop condition

- Add focused regression tests for the failures above using the existing test stack. Demonstrate that the important failure tests fail before their fixes. Avoid tests that only duplicate implementation details.
- Run `npm ci` and `npm test` on each finished PR, and validate the combined branch after overlaps are resolved. Preserve all currently passing regression coverage; report the resulting count, not a target count.
- Request Codex review and fix valid findings, up to the established five review rounds per PR. Five rounds is a limit on review cycling, not permission to merge a known defect. Finish straightforward confirmed corrections; report any genuinely unresolved issue precisely.
- Push the PRs and merge those that are clean, green, and conflict-free within this scope, using the current expected head. Re-check concurrent branch updates; do not overwrite another worker's work or merge a different head than the one checked. Keep changes independently reviewable.
- If this environment cannot reach live relays, finish the code, deterministic tests, and local browser checks. Clearly separate unrun live interoperability checks from completed verification. Do not create infrastructure work or block unrelated repairs on relay access.
- Finish with merged PR links, the final `almost` SHA, test/CI evidence, any remaining real defect, and the exact next manual-deployment inputs from `docs/RELEASE.md`. Identify badge gaps as explicitly deferred, not completed. Do not deploy in this round. Stop once these four scopes are complete; do not start another speculative audit or feature backlog.
