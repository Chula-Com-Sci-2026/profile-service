# Domain Model — Profile Service

> Status: v2 approved. This document is the **spec** and it is authoritative.

## 1. Bounded context

**Profile Service** holds what a runner says about themselves: what they are like, and how, when and where they usually run. It is the source of truth for that: other services may keep copies of what we publish, never the original. Photos are the exception: the image itself lives in object storage owned by this service, and only its key is stored here.

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

Identity is upstream. We are **conformist**: a profile's `id` is Identity's id for its runner — a UUID, the subject of the runner's access token — taken as given and never made here. Identity may delete a runner; nothing tells us, so a profile can outlive the runner it describes. **Not handled yet.**

Buddy Discovery is downstream, and we are its **supplier**: it builds its own copy of how each runner appears to other runners from **ProfileUpdated**, which goes out on RabbitMQ after every change to a profile. It carries the runner's **public card** — visibility already applied, a hidden field as `null`, the point only as its area cell — and the profile's **revision**, so a copy can tell a newer card from an older one that arrived late. A field the runner hid is hidden from matching too: nothing hidden leaves this service. When Buddy Discovery's copy has to be rebuilt, every profile's card can be sent again, each under the revision it already has. Until its own search is live, Buddy Discovery searches through this service instead, with **searchRunners()** (§3). That operation is temporary: it goes once Buddy Discovery searches its own copy.

## 2. Ubiquitous language

Use these words in code, tests, API fields, commit messages, and conversation. A field is called the same everywhere — in a request, the code, the database (in snake_case), events and logs.

| Term | Meaning |
|---|---|
| **Runner** | The person a profile describes. |
| **Profile** | How a runner presents themselves to other runners. |
| **Id** | Identity's id for a runner, a UUID. A profile's `id` is its runner's. |
| **Name** | A runner's name, as shown to others. |
| **Bio** | What a runner writes about themselves. |
| **Pace** | How fast a runner usually runs, as a range in minutes per kilometre: `paceMin`, the faster end, to `paceMax`, the slower. |
| **Experience** | How new or experienced a runner is. |
| **Area** | The name of the place a runner usually runs, such as "Lumphini area". |
| **Point** | Exactly where a runner usually runs: a `latitude` and a `longitude`. Only its owner ever sees it. |
| **Area cell** | The point rounded to about a kilometre: roughly where, not exactly where. |
| **Availability** | When a runner usually runs, in their own words, such as "Tue & Thu 18:00–20:00". |
| **Usual distance** | How far a runner usually runs in one run, as one of three bands. |
| **Gear** | What a runner runs with, such as shoes or a watch. |
| **Photo** | A picture of the runner, kept in this service's object storage. `photoRef` is its key there; `photoUrl` is its public address, worked out from the key wherever a profile is shown. |
| **Public card** | The part of a profile other runners see: the fields the runner has not hidden, with the point only as its area cell. |
| **Hidden field** | A field the runner has chosen to leave off their public card. |
| **Revision** | A profile's version: 1 when it is created, one more with every change. It travels with ProfileUpdated, so a copy can tell the newer of two cards. |

## 3. The aggregate

```
Profile (root)
├─ id             string             required    identity
├─ name           string             required
├─ bio            string
├─ paceMin        number             required
├─ paceMax        number             required
├─ experience     Experience         required    union
├─ area           string             required
├─ latitude       number             required
├─ longitude      number             required
├─ availability   string             required
├─ usualDistance  UsualDistance                  union
├─ gear           string[]
├─ photoRef       string
├─ hiddenFields   HiddenField[]                  union
└─ revision       number             required

   areaCell()     AreaCell           derived     class
```

**One profile per runner.** `Profile` is the single aggregate root and the only entity here — there are no other aggregates in this context, and the whole profile is loaded and saved as one unit. Everything marked `union` or `class` is a value object: no identity, no lifecycle of its own, immutable, compared by value — the marker says only how it is implemented. The unmarked fields are plain primitives, the same kind of value but with no type of their own, so their rules are enforced by the `Profile` constructor instead. `areaCell` is not stored: it is worked out from `latitude` and `longitude` whenever it is asked for.

Of the fields a runner fills in, `name`, the pace, `experience`, `area`, the point and `availability` are required; `bio`, `usualDistance`, `gear` and the photo are their choice. **An unset field is `null`** — never absent, and gear with no items is `null`, never an empty list — the same `null` a request carries and the database stores. `hiddenFields` is always a list, empty until the runner hides something. `revision` is the profile's own, never a runner's to write.

### Behaviour

The team's operations, and one of this service's own, one application file each:

- **saveProfile()** — creates the runner's profile, or replaces it: the team's `createProfile()` and `updateProfile()`, reached through one save. The runner's answers are replaced whole: `name`, the pace, `experience`, `area`, the point and `availability` must all be given, and a `bio` left out is no bio. `usualDistance` and `gear` are kept when left out and cleared with `null` (gear with an empty list too). A save never changes `hiddenFields` or the photo, so it can never reveal or detach anything. The first save creates the profile with nothing hidden and no photo.
- **setFieldVisibility()** — replaces the set of hidden fields.
- **createPhotoUpload()** — a short-lived link to upload a photo to, and the key it will occupy. It changes nothing.
- **attachPhoto()** — puts an uploaded photo on the profile. The key must be one of this runner's, and the photo must have been uploaded.
- **removePhoto()** — takes the photo off the profile.
- **getProfile()** — the whole profile, for its owner.
- **getPublicProfile()** — the public card, for anyone, its owner included.
- **searchRunners()** — *temporary, until Buddy Discovery's own search is live (§1).* Every other runner's public card, each with how far away it is: the great-circle distance between the searcher's area cell and theirs — never between exact points — in kilometres, to one decimal. It keeps the runners within a radius, 10 km unless one is given, nearest first and, at the same distance, by `id`. It can also keep only one `experience`; only runners whose pace range overlaps the searcher's own saved one, ends included; and only those whose `availability` contains some text, ignoring case. The filters read the public card, so a hidden field is `null`: it fails a filter on that field, and passes when that filter is off. The searcher needs a profile of their own.
- **republishProfiles()** — sends every profile's ProfileUpdated again, each under the revision it already has, for a copy that has to be rebuilt (§1). It changes nothing, so no revision moves.
- **publicCard()** — on the aggregate itself: the profile as other runners see it (§4). The one place field visibility is applied.

Every operation that changes a profile raises its revision by one and publishes ProfileUpdated (§1) — even one that leaves every field as it was. `id` never changes. There is no way to delete a profile.

## 4. Fields and their rules

| Field | Rule |
|---|---|
| `id` | A UUID, in lowercase. |
| `name` | 1–80 characters after trimming. |
| `bio` | Up to 240 characters after trimming. A blank bio is no bio. |
| `paceMin`, `paceMax` | Decimal minutes per kilometre. Each is more than 0 and at most 20 as given, then kept to the nearest second — `round(x × 60) / 60` — and one that rounds to 0 is refused. `paceMin` is the faster end, so it is not more than `paceMax`. |
| `experience` | One of `Beginner` · `Intermediate` · `Advanced`, in exactly that case. |
| `area` | 1–100 characters after trimming. |
| `latitude`, `longitude` | Degrees, WGS 84: latitude −90 to 90, longitude −180 to 180. |
| `availability` | 1–120 characters after trimming. |
| `usualDistance` | Exactly one of `Under 5 km` · `5–10 km` · `Over 10 km`. The dash in `5–10 km` is an en dash; `5-10 km` with a hyphen is refused. |
| `gear` | Up to 10 items, each 1–50 characters after trimming. Items keep the runner's order; an item equal to an earlier one once trimmed is the same item, and the limit counts items after that. No items is no gear. |
| `photoRef` | Up to 128 characters. |
| `hiddenFields` | A set of `bio` · `pace` · `availability` · `experience` · `usualDistance` · `gear`, kept in that order. `pace` hides `paceMin` and `paceMax` together. `id`, `name`, `area`, the area cell and the photo can never be hidden. |
| `revision` | A whole number, 1 or more. |

Character counts are Unicode code points: an emoji counts as one character, not two.

### Area cells

A profile's area cell is the point nearest its `latitude` and `longitude` whose latitude and longitude are both multiples of 0.01°. A cell is about 1.1 km across in Bangkok.

### Public card

Exactly `id`, `name`, `area`, the area cell, the photo, and the fields a runner may hide: `bio`, `paceMin` and `paceMax`, `experience`, `availability`, `usualDistance` and `gear`. Every one is always on it: a field that is hidden or unset is `null`, gear included. `id`, `name`, `area` and the cell are never `null`; the photo is `null` when there is none. The point and the hidden set are never on it. A field may be hidden while unset, and stays hidden once set.

## 5. Invariants

An invariant is a rule that must hold every time a profile is saved, whatever else changes. Protecting them is what an aggregate boundary is for.

| Invariant | Enforced by |
|---|---|
| One profile per runner | `id PRIMARY KEY`. The `Profile` constructor cannot enforce this — it sees one profile and would have to look at the others. |
| A profile's revision rises by one with every change | The conditional update: a change is written only where the stored revision is still the one it was made from (`WHERE id = … AND revision = …`). Of two changes made from the same revision, one is written and the other is made again on the new one. The `Profile` constructor cannot enforce this either: it sees one version of the profile. |

Every other rule in §4 constrains a single field on its own, so the `Profile` constructor is enough for them.

When another appears it belongs here, with a note of where it is enforced.
