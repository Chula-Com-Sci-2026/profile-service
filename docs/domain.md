# Domain Model — Profile Service

> Status: v1 approved. This document is the **spec** and it is authoritative.

## 1. Bounded context

**Profile Service** holds what a runner says about themselves: what they are like, and how, when and where they usually run. It is the source of truth for that: other services may keep copies of what we publish, never the original. Profile images are the exception: the image itself lives in object storage owned by this service, and only its key is stored here.

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
          │
          │ customer/supplier
          ▼
┌─────────────────────────┐
│ Buddy Discovery Service │
└─────────────────────────┘
```

Identity is upstream. We are **conformist**: we take its `userId` as given. We never create one, and we treat it as a meaningless string. Identity may delete a runner; nothing tells us, so a profile can outlive the runner it describes. **Not handled yet.**

Buddy Discovery is downstream, and we are its **supplier**: it builds its own copy of how each runner appears to other runners from two events we publish. **ProfileUpdated** goes out after a profile is created or changed and carries the runner's **public card** — visibility already applied, the area as its cell — plus the fields Buddy Discovery matches on: pace range, experience and preferred run times, sent even when the runner hid them from other runners. It should rank on a hidden field and never filter on one, since repeated searches would reveal it, the way NFR-4.1 rules out for the area. **ProfileDeleted** goes out after a profile is removed. Because Buddy Discovery keeps its own copy, this service needs no bulk read.

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
| **Area** | Where a runner usually runs, as one point on the map. |
| **Area cell** | An area rounded to about a kilometre: roughly where, not exactly where. |
| **Pace range** | The fastest and slowest a runner usually runs, as time per kilometre. |
| **Usual distance** | How far a runner usually runs in one run. |
| **Experience** | How new or experienced a runner is. |
| **Preferred run time** | Which days and times of day a runner prefers to run. |
| **Gear** | What a runner runs with, such as shoes or a watch. |
| **Public card** | The part of a profile other runners see: the fields the runner has not hidden, with the area as its cell. |
| **Hidden field** | A field the runner has chosen to leave off their public card. |

## 3. The aggregate

```
Profile (root)
├─ userId             string                required       identity
├─ displayName        string                required
├─ bio                string
├─ avatarRef          string
├─ birthYear          number
├─ gender             Gender                               union
├─ area               Area                  required       class
├─ paceRange          PaceRange                            class
├─ usualDistance      UsualDistance                        class
├─ experience         Experience                           union
├─ preferredRunTimes  PreferredRunTime[]                   class
├─ gear               string[]
└─ hiddenFields       HiddenField[]                        union
```

**One profile per runner.** `Profile` is the single aggregate root and the only entity here — there are no other aggregates in this context, and the whole profile is loaded and saved as one unit. Everything marked `union` or `class` is a value object: no identity, no lifecycle of its own, immutable, compared by value — the marker says only how it is implemented. The unmarked fields are plain primitives, the same kind of value but with no type of their own, so their rules are enforced by the `Profile` constructor instead. Of the fields a runner fills in, only `displayName` and `area` are required; everything else is their choice, and an unset set is empty rather than absent.

### Behaviour

- **createProfile()** — creates a runner's profile.
- **getProfile()** — returns one profile, by id. There is no way to list or search.
- **updateProfile()** — changes a profile. `userId` never changes.
- **deleteProfile()** — removes a profile permanently.
- **publicCard()** — the profile as other runners see it: `userId`, `displayName`, the area cell and `avatarRef` always, and every other field that is set and not hidden.

## 4. Fields and their rules

| Field | Rule |
|---|---|
| `userId` | Non-empty after trimming, ≤ 64 chars. |
| `displayName` | 1–50 chars after trimming. |
| `bio` | ≤ 500 chars. |
| `avatarRef` | ≤ 128 chars. |
| `birthYear` | Integer, 1900 to the current year. |
| `gender` | One of `male` · `female` · `non_binary`. |
| `area` | A point: latitude −90 to 90 and longitude −180 to 180, in degrees (WGS 84). |
| `paceRange` | A fastest and a slowest pace, each integer seconds per kilometre, 150–900 (2:30–15:00 /km). The fastest is not slower than the slowest; one steady pace gives both the same value. |
| `usualDistance` | Integer metres, 1–50 000 (up to 50 km, Run Scheduling's limit for a run). |
| `experience` | One of `beginner` · `intermediate` · `advanced`. |
| `preferredRunTimes` | A set of pairs — a day `mon` · `tue` · `wed` · `thu` · `fri` · `sat` · `sun`, plus a time of day (below). |
| `gear` | A set of up to 10 items, each 1–50 chars after trimming. Items keep the order the runner gave; an item equal to an earlier one after trimming is the same item. |
| `hiddenFields` | A set of `bio` · `birthYear` · `gender` · `paceRange` · `usualDistance` · `experience` · `preferredRunTimes` · `gear`. Empty unless the runner hides something: everything is public until hidden. |

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

### Area cells

An area's cell is the point nearest it whose latitude and longitude are both multiples of 0.01°. A cell is about 1.1 km across in Bangkok.

### Public card

`userId`, `displayName`, `avatarRef` and the area cell are always on it; the exact area never is. Every other field is on it when it is set and not hidden. A hidden field is absent, never null. A field may be hidden while unset, and stays hidden once set.

## 5. Invariants

An invariant is a rule that must hold every time a profile is saved, whatever else changes. Protecting them is what an aggregate boundary is for.

| Invariant | Enforced by |
|---|---|
| One profile per runner | `user_id PRIMARY KEY`. The `Profile` constructor cannot enforce this — it sees one profile and would have to look at the others. |

Every other rule in §4 constrains a single field on its own, so the `Profile` constructor is enough for them.

When another appears it belongs here, with a note of where it is enforced.
