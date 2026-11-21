# Village Vibe

A Nostr-native app for local communities: **tribes** (groups) organise **events**, share
**stories** and offer or request **services**, and **villages** aggregate content from the
tribes associated with a place.

Built with React 18, Vite, TailwindCSS, shadcn/ui, TanStack Query and Nostrify.

## Features

- **Tribes:** NIP-72 community definitions (kind 34550) with roles (admin,
  moderator, event creator, member), join requests, and moderation.
- **Events:** enhanced events (kind 36959) and NIP-52 calendar events, with RSVPs,
  self-reported check-ins, discussion and coordination (roles, items, tasks, outcomes).
- **Stories:** NIP-23 long-form posts rendered as Markdown.
- **Services:** offers and requests (kinds 38857/30627) with responses (kind 34871)
  and NIP-40 expiry.
- **Villages:** feeds built from tribe associations and moderator promotions (NIP-32
  labels).
- **Messages:** NIP-17 private messages, with NIP-04 for older history and simpler signers.
- **Zaps:** NIP-57 zaps via WebLN or Nostr Wallet Connect.

The custom event kinds and tags are specified in [`NIP.md`](./NIP.md).

## Development

```bash
npm ci          # install the locked dependencies
npm run dev     # start the dev server on http://localhost:8080
npm test        # type check, lint, unit tests and production build
npm run build   # production build in dist/
```

### How data is read and written

- **Reads:** reads go through `RelayPool` (`src/lib/RelayPool.ts`), which queries the
  selected relay plus a few fallbacks. A query returns shortly after the first relay
  completes. It returns empty when at least one relay answered with nothing, and fails
  only when no relay answered.
- **Writes:** writes go through `useNostrPublish`, which signs, waits for a relay to accept
  the event, then refreshes the affected queries.
- **Tribe and village links:** content is linked to tribes and villages with relay-indexed
  tags (see "Linking Content to Tribes and Villages" in `NIP.md`).

## Repository notes

- `AUDIT.md`: the code audit and the repair plan.
- `docs/history/`: debugging notes from earlier development sessions (not current docs).
- `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md` and `GEMINI.md`: instructions for AI coding tools.
