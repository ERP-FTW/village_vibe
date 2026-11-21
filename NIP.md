# Village Vibe - Custom Nostr Implementation

This document describes the custom Nostr event kinds and extensions used by Village Vibe for community stories, events, services, and village aggregation.

## Linking Content to Tribes and Villages

Events (36959, 31923), stories (30023) and services (38857, 30627) are linked to their tribe and villages with relay-indexed single-letter tags. Each link is also written in the legacy multi-letter form, so older clients keep working.

| Link | Indexed tags (query with) | Legacy tag (still written) |
|---|---|---|
| Tribe | `["a", "34550:<tribe-owner-pubkey>:<tribe-d-tag>"]` (`#a`) | `["tribe", "<tribe-d-tag>"]` |
| Village | `["t", "village"]` and `["t", "village-<slug>"]` (`#t`) | `["village", "<slug>"]` |

- Village slugs are lowercase ASCII words joined by `-`, for example `east-side`.
- A tribe feed accepts content tagged with the tribe coordinate only from the tribe's members. Events are accepted only from the owner, admins, moderators and event creators.
- A tribe feed drops content that a tribe moderator has labelled `tribe-hidden` (kind 1985).
- A village feed for village V shows content only when one of these holds:
  - its tribe definition is associated with V (the tribe carries `["village", V]`);
  - its author is a moderator of its tribe;
  - a moderator of its tribe published a `village-promoted` label (kind 1985) that references the content and carries `["village", V]`.

  "Its tribe" is the tribe named by the content's `a` coordinate, with the author as a member. Self-applied village tags from anyone else, and labels from non-moderators, are ignored. `village-featured` labels from the tribe's moderators mark content as featured in the villages they name.
- Legacy content names only the tribe's d tag, which a look-alike tribe can reuse. Such content therefore only gets in through rule 1 (an associated tribe the author belongs to), and never through moderator authority.
- Villages have no owners: any tribe creator can associate a tribe with a village. Readers can hide tribes from their village feed.
- Content from before the indexed tags is found through its authors (tribe feeds) or the legacy `village` tag (village feeds).

### Promotion and feature labels

`village-promoted` and `village-featured` labels (kind 1985, `["L", "promotion"]`) reference the content with `["a", "<kind>:<pubkey>:<d>"]`. They name their villages in both forms: the legacy `["village", "<slug>"]` and, since the indexed tag model, `["t", "village"]` plus `["t", "village-<slug>"]`. Older labels carry only the legacy form.

A village feed finds promotions in three ways:

1. **Indexed:** `{"kinds": [1985], "#l": ["village-promoted", "village-featured"], "#t": ["village-<slug>", …]}`, for labels with village topics.
2. **Legacy:** the same filter with `#village`, for older labels. It is sent in its own subscription, because some relays reject multi-letter tag filters.
3. **Recent window:** the newest labels overall. This is a bounded fallback for older labels when the legacy filter isn't available (the all-villages feed, or a relay that rejects it).

Each read is a window of 200 labels. When a source that decides completeness fills its window, the feed reports that older promotions may exist. "Look further back" then reads further windows, inclusive paging with de-duplication by id, up to 10. The feed never claims complete history from a fixed recent window. Labels found this way still only count when they come from a moderator of the content's tribe, as above.

### Upgrading older content to the indexed tags

Only an author can upgrade their own content. Moderators never re-sign it: a label references the address `kind:pubkey:d`, which stays the same when the author republishes. Village Vibe writes the indexed tags whenever an author republishes through the app, for example:

- promoting their own story, event or service to a village (this republishes it with `["t", "village-<slug>"]` alongside `["village", …]`);
- saving an edit (this writes `["a", "34550:…"]` alongside `["tribe", …]`).

Other clients can upgrade content the same way, by republishing it under the same `d` tag with both tag forms. Until then, legacy content stays readable through the legacy filters and fallbacks above.

## Services (Custom Kinds 38857, 30627, 34871)

### Service Offers (38857) and Requests (30627)

Addressable events. Content is the human-readable description.

| Tag | Required | Meaning |
|---|---|---|
| `["d", "<id>"]` | yes | Identifier |
| `["t", "<category>"]` | yes | One of `yardwork`, `pets`, `eldercare`, `errands`, `oddjobs` (first `t` tag) |
| `["tribe", "<tribe-d-tag>"]`, `["a", "34550:<owner>:<d>"]` | yes | Tribe link (see "Linking Content to Tribes and Villages") |
| `["l", "<lat>,<lon>"]` | yes | Approximate location, rounded to 4 decimals |
| `["area", …]`, `["avail", …]`, `["time", …]`, `["rate", …]`, `["radius", …]` | no | Free-text details |
| `["expiration", "<unix>"]` | no | NIP-40 expiry; relays may drop the event after this time. Clients hide expired services, and also honour the legacy `["expires", "<unix>"]` tag. |
| `["village", "<slug>"]`, `["t", "village-<slug>"]` | no | Village links |
| `["alt", …]` | yes | NIP-31 description |

### Service Responses (34871)

Published when someone responds to a service ("I need this" or "I can help"), or when an admin suggests a match.

| Tag | Required | Meaning |
|---|---|---|
| `["d", "match-<sorted service addresses joined by \|>-<responder pubkey>"]` | yes | One response per person per service pairing; responding again replaces it |
| `["type", "offer_to_request" \| "request_to_offer" \| "admin_suggestion"]` | yes | Kind of response |
| `["a", "<kind>:<pubkey>:<d>"]` | yes | The service(s) responded to |
| `["p", "<service author pubkey>"]` | yes | Notifies the author(s) of the referenced services |
| `["by", "<responder pubkey>"]` | yes | Responder (equals the event pubkey) |
| `["alt", …]` | yes | NIP-31 description |

## Stories (NIP-23 Extension)

Village Vibe uses **kind 30023** (Long-form Content from NIP-23) for community stories with the following extensions:

### Required Tags

- `["d", "<stable-story-id>"]` - Parameterized replaceable key for edits
- `["tribe", "<tribe-slug>"]` - Tribe where the story was created
- `["title", "<story-title>"]` - Story title

### Optional Tags

- `["summary", "<one-liner>"]` - Brief description for preview cards
- `["cover", "<img-url>"]` - Cover image URL for story preview
- `["village", "<village-slug>"]` - Added when story is promoted to village
- `["place", "<location-name>"]` - Human-readable location name
- `["g", "<geohash>"]` - Optional approximate location (6-character geohash, a cell of about 0.4 x 0.6 miles). Readers treat it as the whole cell, for example a distance filter matches when any part of the cell is in range. Older events used `["l", "<lat>,<lon>"]`, which clients still read; it collides with NIP-32 label tags, so new events no longer write it.
- `["ref", "<event-id>"]` - Reference to related event (if story is about an event)
- `["alt", "Community story shared with the village"]` - NIP-31 alternative description

### Content

Stories use Markdown content in the `content` field, following NIP-23 guidelines for long-form content.

## Story Moderation (NIP-32 Labels)

Village Vibe uses **kind 1985** (Label from NIP-32) for story moderation with these label values:

### Moderation Labels

- `["l", "tribe-hidden", "moderation"]` - Story hidden from tribe feed
- `["l", "village-promoted", "promotion"]` - Story promoted to village
- `["l", "village-featured", "promotion"]` - Story featured in village hero section

### Required Tags for Labels

- `["a", "30023:<pubkey>:<d-tag>"]` - Reference to the story being labeled
- `["L", "<namespace>"]` - Label namespace ("moderation" or "promotion")

## Village Aggregation

Villages aggregate content using the `village` tag (and the indexed `t` village topics; see Linking Content to Tribes and Villages):

- **Stories**: `["village", "<village-slug>"]` tag added when promoted
- **Services**: `["village", "<village-slug>"]` tag for village-wide services
- **Events**: `["village", "<village-slug>"]` tag for village-wide events

## Enhanced Events (Custom Kind 36959)

Village Vibe uses **kind 36959** (addressable events) for enhanced community events with multi-type support and private event capabilities.

### Required Tags

- `["d", "<stable-event-id>"]` - Parameterized replaceable key for edits
- `["tribe", "<tribe-slug>"]` - Tribe where the event was created
- `["title", "<event-title>"]` - Event title
- `["start", "<unix-timestamp>"]` - Event start time (Unix timestamp)
- `["place", "<location-name>"]` - Human-readable location name
- `["g", "<geohash>"]` - Optional approximate location (6-character geohash, a cell of about 0.4 x 0.6 miles). Readers treat it as the whole cell, for example a distance filter matches when any part of the cell is in range. Older events used `["l", "<lat>,<lon>"]`, which clients still read; it collides with NIP-32 label tags, so new events no longer write it.

### Event Type Tags (Multi-select, Additive)

Events can carry multiple types stored and indexed via tags. Whitelisted values:

- `["etype", "meetup"]` - General meetup
- `["etype", "gathering"]` - General gathering
- `["etype", "potluck"]` - Community potluck
- `["etype", "trivia"]` - Trivia night
- `["etype", "game"]` - Game night
- `["etype", "service-day"]` - Community service day
- `["etype", "cleanup"]` - Cleanup activity
- `["etype", "workshop"]` - Workshop
- `["etype", "skill-swap"]` - Skill sharing/swap
- `["etype", "celebration"]` - Celebration
- `["etype", "ritual"]` - Ritual or ceremony
- `["etype", "market"]` - Market
- `["etype", "swap"]` - Swap meet
- `["etype", "freebie-fair"]` - Freebie fair
- `["etype", "mixer"]` - Social mixer
- `["etype", "matchmaking"]` - Matchmaking event
- `["etype", "council"]` - Council meeting
- `["etype", "tribe-meeting"]` - Tribe meeting

**Multi-type Support**: Events can include multiple `etype` tags for combined event types (e.g., a potluck + cleanup event would have both `["etype", "potluck"]` and `["etype", "cleanup"]` tags).

### Optional Tags

- `["end", "<unix-timestamp>"]` - Event end time
- `["summary", "<brief-description>"]` - Brief description for preview cards
- `["village", "<village-slug>"]` - Added when event is promoted to village
- `["visibility", "public|tribe-only|private"]` - Event visibility level
- `["p", "<invitee-pubkey>"]` - Invitees for private events (repeated)
- `["alt", "Community event for local participation"]` - NIP-31 alternative description

### Type-Specific Enhancement Tags

**Potluck Events:**
- `["food", "main|side|dessert|drinks"]` - Food contribution slots (multiple allowed)
- `["diet_notes", "<notes>"]` - Dietary restrictions/notes

**Service-Day/Cleanup Events:**
- `["task", "trash-pickup|tree-planting|paint"]` - Available tasks (multiple allowed)
- `["tools_needed", "<tool-list>"]` - Required tools and equipment

**Workshop/Skill-Swap Events:**
- `["instructors", "<name-or-npub>"]` - Workshop instructors (multiple allowed)
- `["materials", "<material-list>"]` - Required materials

**Trivia/Game Events:**
- `["game_kind", "<game-type>"]` - Type of game (e.g., trivia, board games)
- `["teams_mode", "auto|custom"]` - Team assignment method

**Celebration/Ritual Events:**
- `["occasion", "<occasion-type>"]` - Celebration type (e.g., birthday, harvest, holiday)

### Content

Events use a short description (≤500 chars) in the `content` field. Longer details should be in linked NIP-23 stories or sent via DMs for private events.

## Private Events

Private events use the same kind 36959 but with specific handling:

1. **Event Shell**: Published with minimal public info and `["visibility", "private"]`
2. **Invitee List**: Include `["p", "<invitee-pubkey>"]` tags for each invitee
3. **Private Details**: Full details (exact address, instructions) sent via NIP-04 DMs to invitees
4. **Visibility**: Only visible to organizer, invitees, and tribe admins

## Event Moderation (NIP-32 Labels)

Enhanced events use **kind 1985** labels for moderation:

### Event Labels

- `["l", "tribe-hidden", "moderation"]` - Event hidden from tribe feed
- `["l", "village-promoted", "promotion"]` - Event promoted to village
- `["l", "village-featured", "promotion"]` - Event featured in village hero section
- `["l", "private-meta", "moderation"]` - Marks private event metadata for filtering

### Required Tags for Event Labels

- `["a", "36959:<pubkey>:<d-tag>"]` - Reference to the event being labeled
- `["L", "<namespace>"]` - Label namespace ("moderation" or "promotion")

## Event Type Filtering

Events can be filtered by one or multiple types using the `etype` parameter:

- Single type: `?etype=potluck`
- Multiple types: `?etype=potluck,service-day,workshop`

Filtering is additive - events matching any of the specified types will be returned.

## Event Coordination System (Kinds 38401-38409)

Village Vibe implements a flexible coordination system for managing people, resources, and tasks for any event type.

### Coordination Event Kinds

- **Kind 38401**: Event Role (volunteer position/shift)
- **Kind 38402**: Role Claim (user signs up for role)
- **Kind 38403**: Event Item (resource to bring/provide)
- **Kind 38404**: Item Claim (user commits to bringing item)
- **Kind 38405**: Event Action (task or milestone)
- **Kind 38406**: Action Update (status change)
- **Kind 38407**: Event Outcome (results/impact record)
- **Kind 38408**: Alert Rule (notification configuration)
- **Kind 38409**: Alert Trigger (notification fired)

### Event Role (Kind 38401)

Addressable event defining a volunteer position or shift.

**Required Tags:**
- `["d", "<role-id>"]` - Unique role identifier
- `["a", "<parent-event-coordinate>"]` - Reference to parent event
- `["e", "<parent-event-id>"]` - Event ID with marker `root`
- `["title", "<role-title>"]` - Role name
- `["slots", "<number>"]` - How many people needed
- `["status", "open|claimed|filled|canceled"]` - Current status

**Optional Tags:**
- `["time_start", "<unix-timestamp>"]` - Shift start time
- `["time_end", "<unix-timestamp>"]` - Shift end time
- `["requirements", "<text>"]` - Required skills/qualifications
- `["external_ref", "<id>"]` - Link to external system

**Content:** Role description and details

### Role Claim (Kind 38402)

Addressable event representing a user claiming a role.

**Required Tags:**
- `["d", "<claim-id>"]` - Unique claim identifier
- `["e", "<role-event-id>"]` - Role being claimed (marker: `reply`)
- `["e", "<parent-event-id>"]` - Root event (marker: `root`)
- `["role", "<role-id>"]` - Role d-tag being claimed
- `["status", "active|withdrawn"]` - Claim status

**Optional Tags:**
- `["notes", "<text>"]` - User notes about availability

### Event Item (Kind 38403)

Addressable event defining a resource needed for the event.

**Required Tags:**
- `["d", "<item-id>"]` - Unique item identifier
- `["a", "<parent-event-coordinate>"]` - Reference to parent event
- `["e", "<parent-event-id>"]` - Event ID with marker `root`
- `["title", "<item-name>"]` - Item name
- `["quantity", "<number>"]` - Amount needed
- `["status", "needed|claimed|confirmed|canceled"]` - Current status

**Optional Tags:**
- `["category", "<category>"]` - Item category (food, tools, supplies)
- `["unit", "<unit>"]` - Unit of measurement (servings, pieces, hours)
- `["external_ref", "<id>"]` - Link to external system

**Content:** Item description and details

### Item Claim (Kind 38404)

Addressable event representing a user claiming an item.

**Required Tags:**
- `["d", "<claim-id>"]` - Unique claim identifier
- `["e", "<item-event-id>"]` - Item being claimed (marker: `reply`)
- `["e", "<parent-event-id>"]` - Root event (marker: `root`)
- `["item", "<item-id>"]` - Item d-tag being claimed
- `["quantity", "<number>"]` - Amount being brought
- `["status", "active|withdrawn"]` - Claim status

**Optional Tags:**
- `["notes", "<text>"]` - User notes

### Event Action (Kind 38405)

Addressable event defining a task or milestone.

**Required Tags:**
- `["d", "<action-id>"]` - Unique action identifier
- `["a", "<parent-event-coordinate>"]` - Reference to parent event
- `["e", "<parent-event-id>"]` - Event ID with marker `root`
- `["title", "<action-title>"]` - Action name
- `["status", "pending|in-progress|done|blocked|canceled"]` - Current status

**Optional Tags:**
- `["p", "<pubkey>"]` - Assigned to user (marker: `assigned`)
- `["due_date", "<unix-timestamp>"]` - Deadline
- `["priority", "low|medium|high|urgent"]` - Priority level
- `["depends", "<action-id>"]` - Dependency (repeatable)
- `["external_ref", "<id>"]` - Link to external system

**Content:** Action description

### Action Update (Kind 38406)

Addressable event updating an action's status.

**Required Tags:**
- `["d", "<update-id>"]` - Unique update identifier
- `["e", "<action-event-id>"]` - Action being updated (marker: `reply`)
- `["e", "<parent-event-id>"]` - Root event (marker: `root`)
- `["action", "<action-id>"]` - Action d-tag being updated
- `["status", "<new-status>"]` - New status value

**Optional Tags:**
- `["notes", "<text>"]` - Update notes

**Content:** Update message

### Event Outcome (Kind 38407)

Addressable event recording event results and impact.

**Required Tags:**
- `["d", "<outcome-id>"]` - Unique outcome identifier
- `["a", "<parent-event-coordinate>"]` - Reference to parent event
- `["e", "<parent-event-id>"]` - Event ID with marker `root`
- `["type", "metric|story|photo|feedback"]` - Outcome type
- `["title", "<outcome-title>"]` - Outcome name

**Optional Tags:**
- `["value", "<number>"]` - Metric value
- `["unit", "<unit>"]` - Metric unit
- `["media", "<url>"]` - Photo or media URL
- `["external_ref", "<id>"]` - Link to external system

**Content:** Outcome description or story

### Coordination Trust Rules

- Roles (38401), items (38403), actions (38405) and outcomes (38407) count only when authored by the event organizer or by a moderator of the event's tribe. The tribe must be named by the event's `a` coordinate (`34550:<owner>:<d>`), and the organizer must be a member of it. A bare `tribe` d tag never grants moderator trust.
- Role and item claims (38402, 38404) use the d tag `claim-<role-or-item-id>-<claimer-pubkey>`, so each person has one claim per role or item. To withdraw, republish the claim with `["status", "withdrawn"]`.
- Fills count distinct people with an active claim. An item claim's `quantity` is the claimer's total for that item, and item totals sum those per person.
- Legacy item claims (any other d tag) were published once per submission with only the added quantity. Until a person publishes their canonical `claim-<item-id>-<pubkey>` claim, their legacy claims for that item are summed. Once it exists, the canonical claim replaces them, so clients must fold any legacy quantity into the first canonical total.
- An action update (38406) counts only when authored by the organizer, a trusted tribe moderator, the action's creator or its assignee. The newest one wins.

## Implementation Notes

1. **Privacy**: Location coordinates are rounded to 4 decimal places (~11m precision) for privacy
2. **Moderation**: All moderation is additive (labels) and non-destructive
3. **Promotion**: Events start in tribes and can be promoted to villages by tribe admins
4. **Editability**: Events use parameterized replaceable events for editing capability
5. **Multi-Type**: Events can have multiple `etype` tags for combined event types
6. **Private Events**: Use DMs for sensitive details, event shell remains public with minimal info
7. **Interoperability**: Based on existing NIPs (52, 23, 32, 04) for maximum compatibility
8. **Coordination**: Roles, Items, Actions, and Outcomes use addressable events (kinds 38401-38407)
9. **External References**: All coordination objects support `external_ref` tags for linking with external systems (Cooking with Grace, etc.)

## Example Enhanced Event

```json
{
  "kind": 36959,
  "created_at": 1704067200,
  "content": "Join us for our monthly community potluck and garden cleanup! Bring a dish to share and help us maintain our beautiful community garden space.",
  "tags": [
    ["d", "potluck-cleanup-2024-01"],
    ["tribe", "green-thumbs"],
    ["title", "Community Potluck & Garden Cleanup"],
    ["start", "1704124800"],
    ["end", "1704135600"],
    ["place", "Community Center Garden"],
    ["g", "dr5reg"],
    ["etype", "potluck"],
    ["etype", "cleanup"],
    ["food", "main"],
    ["food", "side"],
    ["food", "dessert"],
    ["diet_notes", "vegetarian options available"],
    ["task", "weeding"],
    ["task", "composting"],
    ["tools_needed", "gloves, rakes, compost bins"],
    ["village", "brooklyn-heights"],
    ["visibility", "public"],
    ["alt", "Community event for local participation"]
  ],
  "pubkey": "...",
  "id": "..."
}
```

## Example Private Event

```json
{
  "kind": 36959,
  "created_at": 1704067200,
  "content": "Small gathering for tribe members. Details will be shared privately.",
  "tags": [
    ["d", "private-gathering-2024-01"],
    ["tribe", "green-thumbs"],
    ["title", "Private Tribe Gathering"],
    ["start", "1704124800"],
    ["place", "Private Location"],
    ["g", "dr5reg"],
    ["etype", "meetup"],
    ["visibility", "private"],
    ["p", "abc123..."],
    ["p", "def456..."],
    ["alt", "Private community event"]
  ],
  "pubkey": "...",
  "id": "..."
}
```

## Example Story Event

```json
{
  "kind": 30023,
  "created_at": 1704067200,
  "content": "# Community Garden Success\n\nOur tribe's community garden project has been thriving! We've harvested over 200 pounds of vegetables this season and shared them with local families in need.\n\n## What We Learned\n\n- Collaboration makes everything better\n- Fresh vegetables taste amazing\n- Community building happens naturally around shared goals\n\nThanks to everyone who participated!",
  "tags": [
    ["d", "garden-success-2024"],
    ["tribe", "green-thumbs"],
    ["title", "Community Garden Success Story"],
    ["summary", "Our tribe's garden project harvested 200+ pounds of vegetables for local families"],
    ["cover", "https://example.com/garden-photo.jpg"],
    ["place", "Community Center Garden"],
    ["g", "dr5reg"],
    ["village", "brooklyn-heights"],
    ["alt", "Community story shared with the village"]
  ],
  "pubkey": "...",
  "id": "..."
}
```

## Example Moderation Label

```json
{
  "kind": 1985,
  "created_at": 1704067800,
  "content": "Promoting this inspiring story to the village feed",
  "tags": [
    ["a", "30023:abc123...:garden-success-2024"],
    ["L", "promotion"],
    ["l", "village-promoted", "promotion"],
    ["alt", "Story moderation label: village-promoted"]
  ],
  "pubkey": "...",
  "id": "..."
}
```
## Tribes (NIP-72 Communities, Kind 34550)

Tribes are NIP-72 community definitions. Only the creator's key can replace the definition. Clients must refuse to publish one from another key: that would create a separate community under that key.

| Tag | Meaning |
|---|---|
| `["d", "<id>"]` | Identifier; the tribe id used in URLs is `<creator-pubkey>:<d>` |
| `["name", …]`, `["description", …]`, `["image", …]`, `["location", …]` | Display fields |
| `["t", "tribe"]` | Discovery tag |
| `["public"]` / `["private"]` | Listed in discovery, or only shown to members |
| `["open"]` / `["closed"]` | Informational; joining always goes through a request |
| `["p", "<pubkey>", "<relay>", "<role>"]` | Member, one tag per member. Role is `admin`, `moderator`, `event_creator` or `member`. The creator is always treated as an admin. |
| `["village", "<slug>"]` | Villages the tribe is associated with (see village feed rules) |

Before republishing, clients fetch the newest definition and write a `created_at` later than it, so concurrent changes don't overwrite each other.

### Join Requests (Kind 9021) and Rejections (Kind 9022)

- **Join request (9021):** published by the requester, with `["h", "<creator-pubkey>:<d>"]` and `["p", "<creator-pubkey>"]`. The creator approves by adding the requester's `p` tag to the tribe definition.
- **Rejection (9022):** published by a tribe moderator, with `["h", …]`, `["p", "<requester>"]` and `["e", "<request-id>"]`. Only rejections from the tribe's admins and moderators count.

Note that NIP-29 defines kind 9022 as a "leave request". Village Vibe's tribes are NIP-72 communities, not NIP-29 groups, so the two don't interact, but the kind number overlaps.

## Event Check-ins (Kind 2073)

Published by an attendee who entered the host's check-in code.

| Tag | Meaning |
|---|---|
| `["a", "<event-kind>:<host-pubkey>:<d>"]` | The event (36959 or 31923) |
| `["e", "<event-id>"]`, `["p", "<host-pubkey>"]` | Event revision and host |
| `["nonce", "<13-digit code>"]` | Code shown by the host |
| `["verified_at", "<unix>"]` | Time of check-in |

Check-ins are self-reported. The code is generated in the host's client and not verified by anyone else, so clients label them as such.

## Profile Privacy (Kind 30078, NIP-78)

Addressable app data with `["d", "profile-privacy"]`. The content is JSON: `{"showBasicInfo": boolean, "showTribes": boolean, "showBadges": boolean}`. These settings only control what Village Vibe shows on its own profile page. Kind 0 metadata, badge awards and tribe membership remain public on Nostr.
