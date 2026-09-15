# Domain Model — Profile Service

> Status: v1 approved. This document is the **spec** and it is authoritative.

## 1. Bounded context

**Profile Service** holds what a runner says about themselves: what they are like, and how, when and where they usually run. It is the source of truth for that — no other service stores it. Profile images are the exception: the image itself lives in object storage owned by this service, and only its key is stored here.

### Context map

```
┌───────────────────┐
│ Identity Service  │
└───────────────────┘
          │
          │ conformist
          ▼
┌───────────────────┐
│  Profile Service  │
│  (this service)   │
└───────────────────┘
          ┊
          ┊ deferred
          ▼
┌───────────────────┐
│ Discovery Service │
└───────────────────┘
```

Identity is upstream. We are **conformist**: we take its `userId` as given. We never create one, and we treat it as a meaningless string. Identity may delete a runner; nothing tells us, so a profile can outlive the runner it describes. **Not handled yet.**

Discovery is downstream — it will need profiles to match runners — but nothing connects us yet. That link is **deferred, not declined**. How Discovery gets profile data is undecided: a copy it builds from events we publish, or queries it makes to us. That is a decision for both services together, and it is what decides whether this service ever exposes a bulk read.

## 2. Ubiquitous language

Use these words in code, tests, API fields, commit messages, and conversation.

| Term | Meaning |
|---|---|
| **Runner** | The person a profile describes. |
| **Profile** | How a runner presents themselves to other runners. |
| **User id** | The Identity Service's identifier for a runner. |
| **Display name** | A runner's name, as shown to others. |
| **Bio** | What a runner writes about themselves. |
| **Avatar reference** | A key to a runner's profile image in this service's object storage. |
| **Birth year** | The year a runner was born. |
| **Gender** | How a runner describes their gender. |
| **Area** | The public place a runner usually runs. |
| **Pace** | How fast a runner runs, as time per distance. |
| **Volume** | How far a runner typically runs in a week. |
| **Experience** | How new or experienced a runner is. |
| **Preferred distance** | Which running distances a runner prefers. |
| **Preferred run time** | Which days and times of day a runner prefers to run. |

## 3. The aggregate

```
Profile (root)
├─ userId             string                required       identity
├─ displayName        string                required
├─ bio                string
├─ avatarRef          string
├─ birthYear          number                required
├─ gender             Gender                               union
├─ area               Area                                 union
├─ pace               Pace                                 class
├─ volume             Volume                               class
├─ experience         Experience                           union
├─ preferredDistances PreferredDistance[]                  class
└─ preferredRunTimes  PreferredRunTime[]                   class
```

**One profile per runner.** `Profile` is the single aggregate root and the only entity here — there are no other aggregates in this context, and the whole profile is loaded and saved as one unit. Everything marked `union` or `class` is a value object: no identity, no lifecycle of its own, immutable, compared by value — the marker says only how it is implemented. The unmarked fields are plain primitives, the same kind of value but with no type of their own, so their rules are enforced by the `Profile` constructor instead. Of the fields a runner fills in, only `displayName` and `birthYear` are required; everything else is their choice, and an unset set is empty rather than absent.

### Behaviour

- **createProfile()** — creates a runner's profile.
- **getProfile()** — returns one profile, by id. There is no way to list or search.
- **updateProfile()** — changes a profile. `userId` never changes.
- **deleteProfile()** — removes a profile permanently.

## 4. Fields and their rules

| Field | Rule |
|---|---|
| `userId` | Non-empty after trimming, ≤ 64 chars. |
| `displayName` | 1–50 chars after trimming. |
| `bio` | ≤ 500 chars. |
| `avatarRef` | ≤ 128 chars. |
| `birthYear` | Integer, 1900 to the current year. |
| `gender` | One of `male` · `female` · `non_binary`. |
| `area` | One of `lumphini` · `benchakitti` · `chatuchak`. |
| `pace` | Integer seconds per kilometre, 150–900 (2:30–15:00 /km). |
| `volume` | Integer metres per week, 0–500 000 (0–500 km). |
| `experience` | One of `beginner` · `intermediate` · `advanced`. |
| `preferredDistances` | A set of `5k` · `10k` · `half_marathon` · `marathon`. |
| `preferredRunTimes` | A set of pairs — a day `mon` · `tue` · `wed` · `thu` · `fri` · `sat` · `sun`, plus a time of day (below). |

Character counts are Unicode code points: an emoji counts as one character, not two.

### Times of day

All times are Bangkok local time (UTC+7).

| Value | Clock |
|---|---|
| `early_morning` | 05:00–08:00 |
| `morning` | 08:00–11:00 |
| `midday` | 11:00–14:00 |
| `afternoon` | 14:00–17:00 |
| `evening` | 17:00–20:00 |
| `night` | 20:00–05:00 |

## 5. Invariants

An invariant is a rule that must hold every time a profile is saved, whatever else changes. Protecting them is what an aggregate boundary is for.

| Invariant | Enforced by |
|---|---|
| One profile per runner | `user_id PRIMARY KEY`. The `Profile` constructor cannot enforce this — it sees one profile and would have to look at the others. |

Every other rule in §4 constrains a single field on its own, so the `Profile` constructor is enough for them.

When another appears it belongs here, with a note of where it is enforced.
