# Build Plan — Profile Service

> Status: approved. [domain.md](./domain.md) is the spec and it is authoritative; [openapi.yaml](./openapi.yaml) is the HTTP contract. This file is the order of work.

Nothing is built yet. `src/`, `tests/` and `drizzle/` exist and are empty; the configuration, the two specs above and `scripts/seed.json` are the whole starting point.

**Prerequisites: Node ≥ 24 and a running Docker engine.** Docker is not optional in any phase — PostgreSQL runs in it for development, the integration tests start their own container, and phase 6 ships the service as an image. Nothing else needs installing by hand.

## Stack

| | |
|---|---|
| Runtime | Node ≥ 24, ESM (`"type": "module"`). `@types/node` stays on the matching major, so TypeScript only knows the APIs this Node actually has — newer types would let code compile and then crash |
| Language | TypeScript `~6.0.3` — `strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` and `erasableSyntaxOnly`. Tilde rather than caret because `typescript-eslint` refuses TypeScript 6.1 and above: a caret would pull it on someone's next install and break `npm run lint` |
| HTTP | Hono 4 + `@hono/node-server`, with Zod 4 validating at the edge and nowhere else — shape at the boundary, rules in the domain |
| Auth | `jose` 6 — zero dependencies, built on Web Crypto. It verifies Identity's HS256 access tokens with the secret every service shares (ADR-0022) |
| Data | PostgreSQL 16 (`docker-compose.yml`), the version ADR-0015 names, Drizzle ORM 0.45 + `pg`. Drizzle has no decorators and no active record, so the aggregate carries no persistence annotations — the schema is a separate declaration in `infrastructure/` and a mapper bridges the two |
| Observability | `pino` 10 for structured JSON logs, with `pino-pretty` 13 in development only. No metrics and no tracing yet — this row is where they would go. Not installed yet |
| Quality | Vitest 5, unit and integration in separate configs; the integration suite provisions its own PostgreSQL with `@testcontainers/postgresql` 12. `openapi.yaml` is checked against real responses by `ajv` 8 and `yaml` 2. None of those three is installed yet. ESLint 10 + typescript-eslint enforces the import zones |
| Build and packaging | `tsc` to `dist/`, no bundler; then a multi-stage Docker image, which is the unit of deployment |
| Integrations | **Object storage** — MinIO via `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, pinned by release tag. **Profile events** — `ProfileUpdated` and `ProfileDeleted` to Buddy Discovery as synchronous REST POSTs (ADR-0019, phase 1): CloudEvents 1.0 in JSON over Node's own `fetch`, with a short-lived service token from Identity. No broker and no outbox yet — those sit under **Deferred on purpose** |

Everything above is installed. Each arrived in the phase that first used it, never earlier — a dependency installed ahead of the code that exercises it is an unverified guess, and its version is stale by the time it matters.

They split along the line the container cares about: `hono`, `@hono/node-server`, `drizzle-orm`, `pg`, `zod`, `jose`, `pino` and the two `@aws-sdk` packages ship inside it; everything else stays in the toolbox and is stripped by `npm ci --omit=dev`.

`exactOptionalPropertyTypes` is the flag that shapes the domain: an optional field is *omitted*, never passed as `undefined`. That is what makes domain.md §3's "an unset scalar is absent" true in the type system rather than only in prose.

This file is the only record of the stack and the layering rules — the why, at length. [README.md](../README.md) is the other half: what to type, short enough to read before you start. There is no `CLAUDE.md`.

## Layout and the one rule

```
src/
├─ domain/           entities, value objects, domain errors, repository interfaces
├─ application/      use cases, one file per use case
│  └─ ports/        contracts infrastructure implements — the one thing it may import from here
├─ infrastructure/   drizzle schema, repository implementation, db client, config
├─ interface/http/   hono routes, middleware, zod validators, mappers
└─ index.ts          composition root — the only file that knows every layer
tests/
├─ unit/             no database, no network
└─ integration/      real PostgreSQL, serial; globalSetup starts the container
```

**Dependencies point inward only.**

```
interface/http ──► application ──► domain ◄── infrastructure
```

- `domain/` imports only other domain files and Node built-ins — no framework, no ORM, no HTTP, no logger
- `application/` depends on `domain/` and on the repository *interface* declared there, never on `infrastructure/`. It may declare its own ports in `ports/` for things the domain has no use for
- `infrastructure/` is the only place the ORM appears
- `interface/http/` holds no business rules

The point: the domain stays testable with no database and no HTTP, and swapping Drizzle touches one directory.

`eslint.config.js` enforces this with per-directory `no-restricted-imports` zones, so a violation fails `npm run lint` with the layer's own rule as the message. `src/index.ts` is exempt — the composition root is the one place that knows every layer exists.

## Naming across layers

- camelCase in TypeScript and JSON, snake_case in the database. Mapping happens in `infrastructure/`, nowhere else
- kebab-case for file names, including files that export a single class — `preferred-run-time.ts`, not `PreferredRunTime.ts`. On macOS those two are the same file; on Linux they are not
- Units live in the type, not the name — each end of `paceRange` is a `Pace` and `usualDistance` is a `UsualDistance`, with openapi.yaml carrying "seconds per kilometre" and "metres". A bare number called `pace` is a bug
- Use domain.md §2's words everywhere: class names, fields, tests, commits

## Imports

Relative imports name the file on disk, extension included:

```ts
import { Profile } from './profile.ts'
```

TypeScript never rewrites an import specifier by itself — what you type is what ships — so an extensionless `'./profile'` compiles clean and then fails at runtime, because Node ESM requires a full specifier. Two flags make the honest spelling work: `allowImportingTsExtensions` lets the source say `.ts`, and `rewriteRelativeImportExtensions` emits `.js`.

The alternative — writing `'./profile.js'` for a file that is not called that — is the more common convention, and it was rejected here for saying something untrue. If you are about to "fix" the extensions, this is the paragraph you are looking for.

Verified on this toolchain: `tsc`, `node`, `vitest` and `eslint` all accept it. `moduleResolution: "nodenext"` is what turns a forgotten extension into a compile error rather than a crash in production — the same trade as the ESLint import zones.

## Phases

Built inside-out, so every phase is testable the moment it exists. Phases 2 and 3 are the exception: both depend only on phase 1 — a use case needs the repository *interface*, never its implementation — so either could come first. Infrastructure goes first deliberately, because Testcontainers, the migration workflow and the row-to-domain mapper are the least-known work in the plan, and learning they are wrong is cheaper in week one than in week three.

### 0 — Scaffold

Already done: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js`, `vitest.config.ts`, `vitest.int.config.ts`, `drizzle.config.ts`, `docker-compose.yml`, `.env.example`.

Scripts defined: `dev` · `build` · `typecheck` · `lint` · `test` · `test:int` · `db:generate` · `db:migrate` · `db:reset` · `db:seed`. Between them they name three files that do not exist yet — `src/index.ts`, `src/infrastructure/schema.ts` and `scripts/seed.ts` — which are the targets of phases 1–5.

`eslint.config.js` already carries the import zones, so the dependency rule is enforced from the first file written.

Two configs, because type-checking and emitting want different inputs. `tsconfig.json` checks everything — source, tests, scripts and the config files themselves — and emits nothing. `tsconfig.build.json` extends it and is the only one that emits: `src/` alone, `rootDir` there, `outDir` to `dist/`, source maps on so a logged stack trace points back at TypeScript.

`moduleResolution` is `nodenext` rather than `Bundler`, which is what makes the import convention enforceable — see **Imports**. `erasableSyntaxOnly` keeps the source to syntax Node can strip unaided — no `enum`, no parameter properties — which the `as const` unions of phase 1 satisfy anyway, and which is what keeps `node src/index.ts` working with no build at all.

**Done when** `npm run typecheck`, `npm run lint` and `npm test` pass with zero source files. `npm run build` reports `TS18003: No inputs were found` until phase 1 writes the first file — that is correct, not a broken scaffold — and from then on it must produce a `dist/` that `node` runs.

### 1 — Domain

No database, no HTTP, no framework. Everything here comes from domain.md §3, §4 and §5.

- Value object classes — `Area`, `Pace`, `PaceRange`, `UsualDistance`, `PreferredRunTime`. Each validates in its constructor, is immutable after, and is compared by value. `AreaCell` is one more, made only by an `Area`, so it has nothing to validate
- Union types — `Gender`, `Experience`, `HiddenField`. `as const` arrays plus `typeof X[number]`, so one declaration gives both a runtime list and the type
- `Profile` — the aggregate root. Validates the six plain fields itself — `userId`, `displayName`, `bio`, `avatarRef`, `birthYear`, `gear` (§4) — holds the value objects, and is frozen. `userId` is its identity. It builds its own public card, `publicCard()` — the one place field visibility is applied
- `profile.update(changes)` returns a **new** frozen `Profile` rather than mutating. What an absent field means and what a null means are domain rules, so the merge happens here and not in `application/`. One method, not `rename()` and `moveTo()`: §2's language contains no intention richer than editing a profile, and the API delivers a single merge patch — there is nothing to reveal that `updateProfile()` does not already say
- Domain errors — `ProfileNotFoundError`, `ProfileAlreadyExistsError`, and one for a field that breaks a §4 rule. Never an HTTP status in this layer
- `ProfileRepository` interface — `findById`, `insert`, `update`, `delete`. `insert` and `update` are separate so §5's invariant is enforced by the primary key, not by a check-then-write race. **Reads report absence, writes raise conflicts**: `findById` returns `Profile | null` and `delete` reports whether a row went, because a missing profile is a normal result of a query — treating it as an error is policy, and policy belongs to the use case. `insert` does throw `ProfileAlreadyExistsError`, since a unique violation is not a normal outcome of a write

**Done when** every rule in §4 has a unit test that runs with no database, including the rejections.

### 2 — Infrastructure

- Drizzle schema at `src/infrastructure/schema.ts` — `drizzle.config.ts` already points there. One table, `profiles` — `user_id text PRIMARY KEY`, one row per profile, no surrogate id
- Fifteen columns: one per §3 field, two for `area` — `area_latitude` and `area_longitude`, `double precision`, which round-trips a JavaScript number exactly — and two for `paceRange`, `pace_fastest` and `pace_slowest`, which a CHECK keeps both set or both empty. `NOT NULL` on the required fields (`user_id`, `display_name`, the area) **and on every set** — an unset set is `[]`, never null, so the column has no third state. `text` for the unions, not Postgres `enum` — altering an enum is a migration, altering a check is not
- Collections stay in the row as `jsonb`. Nothing queries them — there is no list or search — so per-member indexes and child tables buy nothing, and one row keeps "loaded and saved as one unit" literal
- Sets are normalised on write — members sorted into declared enum order (`mon` before `tue`, `early_morning` before `night`; `bio` before `gear` in `hiddenFields`), never alphabetical. Storage is then deterministic and tests can assert literal arrays. `gear` is the exception: it has no declared order, so it keeps the runner's, with duplicates collapsed
- `npm run db:generate` for the migration, committed to `drizzle/`. It creates `drizzle/meta/` itself — an *empty* `meta/` makes it fail on a missing `_journal.json`, so never create that folder by hand. **Name every migration** — `npx drizzle-kit generate --name=create_profiles`. Left alone it picks an adjective and a Marvel character, which tells a reader nothing; the `0000_` prefix is what orders them, and `meta/_journal.json` records the tag, so renaming afterwards means editing the filename and the journal together
- `DrizzleProfileRepository implements ProfileRepository`. This is also where a driver error becomes a domain one: a unique violation on `user_id`, SQLSTATE `23505`, is caught here and rethrown as `ProfileAlreadyExistsError`, so nothing above this layer ever sees a `pg` error
- A mapper both ways: snake_case ↔ camelCase, columns ↔ value objects. **Row → domain is a boundary** — every union and value object is re-validated on the way in, because §4's rules live in TypeScript and the table enforces none of them
- **Integration tests bring their own database.** A `globalSetup` starts `postgres:16-alpine` through Testcontainers, applies the migrations, hands the URL to the suite, and stops the container afterwards. Between tests, `TRUNCATE profiles` — one table needs nothing cleverer. `docker-compose.yml` is untouched and still serves `npm run dev` and `db:seed`

  The consequence worth having: **`git clone && npm ci && npm run test:int` passes on a machine that has never seen this project** — no port to free, no database to create by hand, no second environment variable, and the same command in CI as on a laptop. It asks one thing in return, that Docker is running, which every option here asks anyway. Two notes: the image tag appears in both `docker-compose.yml` and the setup file and the two must move together, and `vitest.int.config.ts` no longer needs its `.env` load for `DATABASE_URL`, since the container supplies it

**Done when** repository integration tests pass against real PostgreSQL — not a mock, not sqlite. Include the unique-violation path: driver errors may be wrapped, so find the SQLSTATE rather than assuming its depth.

### 3 — Application

One file per use case, named exactly for domain.md §3's operations:

```
createProfile   getProfile   updateProfile   deleteProfile
```

Each takes the repository interface, never a concrete class. `updateProfile` takes a set of changes: an absent field is left alone, an explicit null clears it. That is a partial-update semantic, not an HTTP one — the media type that expresses it is phase 4's business, and the merge itself belongs to `profile.update()` from phase 1.

A missing profile is an **exception, never a `null` return**: `getProfile`, `updateProfile` and `deleteProfile` all throw `ProfileNotFoundError`, which is what phase 4 maps to 404. Returning null instead would move a domain fact — *this runner has no profile* — out to the edge for the HTTP layer to reinterpret.

**Done when** each use case has a test using an in-memory repository, with no database. Helpers and test doubles live beside the suite that uses them — there is no shared `support/` folder.

### 4 — Interface / HTTP

Everything here comes from openapi.yaml.

The middleware in this phase are factories. The base logger and the config object they need belong to phase 5's composition root, so this phase declares what it requires and takes it as an argument rather than constructing it — which is why the dependency appears to point forward.

Order is error handler outermost, then request context, then auth, then routes — the only arrangement in which the error handler can catch what the others throw. **Auth is mounted on `/v1/*`, not globally**, so `/health` never reaches it. That mirrors openapi.yaml, where `/health` is the one operation carrying `security: []`, and unlike relying on registration order it survives someone reshuffling the routes.

- Hono routes for the four verbs on `/v1/profiles/:userId`, plus the two operational endpoints — `GET /health`, which touches nothing, and `GET /ready`, which pings the database through an injected probe. Both are public: an orchestrator and a load balancer have no token
- One middleware, first in the chain, establishes the request context: it reads `traceparent` or `X-Request-Id`, generates a UUID when neither is present (`node:crypto` — no dependency), echoes it back on the response, and puts `log = base.child({ requestId })` on the context. Every line written while serving that request then carries the id, with no logger threaded through call signatures. `hono/logger` exists but writes prose rather than JSON, so it is not used
- One middleware verifies the bearer JWT from Identity **locally** with `jose` and produces a typed `caller` from its subject. No route, use case or domain object ever sees a header or a token. Ownership is then one comparison: caller vs the `userId` in the path

  ```ts
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ['HS256'], issuer, audience, requiredClaims: ['exp', 'iss', 'aud', 'sub'],
  })
  c.set('caller', { id: payload.sub.toLowerCase() }) // once the subject is known to be a UUID
  ```

  The same check as Identity's own middleware and Notification's
- Zod validators matched to `ProfileWrite` and `ProfilePatch` — shape only; the rules live in the domain. A patch body is *not* the resource shape: seven fields accept `null` to clear, `displayName` and `area` do not, a set is replaced by sending a new array, and an area and a pace range are each replaced whole. Zod infers an optional field as `T | undefined`, which `exactOptionalPropertyTypes` refuses to hand to the domain — so the mapper omits the key, `...(v !== undefined && { k: v })`, rather than forwarding an `undefined`
- A view mapper: domain object → JSON. An unset scalar is absent, never null; an unset set is `[]`; a `PaceRange` becomes `{ fastest, slowest }` in seconds. It takes an audience: the owner gets every field, the exact `area` and `hiddenFields`; anyone else gets `profile.publicCard()` serialised
- Error middleware: domain error → RFC 9457 problem+json with `title`, `status`, optional `detail` — and the statuses openapi.yaml enumerates: **400** malformed body or unknown field, **401** no or invalid token, **403** not the owner, **404** no such profile, **409** already exists, **422** a value breaks a §4 rule, **500** otherwise. A 500 is the one response that deliberately tells the client nothing useful, so `log.error({ err })` here is the only record that the failure happened at all
- **The contract is asserted, not promised.** A helper loads `openapi.yaml` once, resolves the schema for an operation and a status, and validates the response body:

  ```ts
  expectContract('createProfile', 201, res)
  ```

  Every test gains a line, and because this phase already covers every operation and every status, the document is checked in full. OpenAPI 3.1 *is* JSON Schema 2020-12, so Ajv's 2020 build reads the schemas as they stand — `unevaluatedProperties`, the `allOf` with sibling `required`, and the `$ref`s into `ProfileFields/properties/…` all resolve — with strict mode off, since the document carries OpenAPI keywords Ajv has no opinion about. One further test asserts the reverse direction: every `operationId` in the document is exercised by at least one test, which is what catches a spec describing an endpoint nobody built

**Done when** integration tests cover every operation and every status openapi.yaml documents, and every one of those responses is validated against the document itself.

### 5 — Wiring and seed

- `src/index.ts` — composition root: config from environment, the base logger, one pool, routes, listen. It **calls** `infrastructure/`'s `config.ts` and `database.ts` rather than building either itself — `pg` and `drizzle-orm` stay behind that boundary, and "one pool" means one instance, not one construction site. The zones exempt `src/index.ts`, so this is the single file where "the ORM appears in `infrastructure/` and nowhere else" is on the honour system; the exemption is there to let the root see every layer, not to let it reach past one. The logger is constructed here and nowhere else — level from configuration, `redact` covering the `authorization` header so a bearer token never reaches a log line, and plain JSON to stdout. Shipping, rotating and prettifying are somebody else's process — the `dev` script gains a `| pino-pretty` in this phase, a pipe rather than a transport, since a transport would run pretty-printing inside this process
- Config read once at startup; a missing `DATABASE_URL` or `ACCESS_TOKEN_SECRET` fails there, not on the first request. Every setting `.env.example` carries is validated in `config.ts` rather than trusted, `LOG_LEVEL` defaulting to `info` and set to `silent` under test. `JWT_ISSUER` and `JWT_AUDIENCE` default to the team's `cant-run-alone-local` and `cant-run-alone-services`
- Graceful shutdown: stop accepting, close idle connections, end the pool, and give up after a deadline rather than hanging
- `scripts/seed.ts` — reads `scripts/seed.json` and inserts through `createProfile`, so a row that breaks §4 fails at seed time rather than landing in the table. Refuses to run when `NODE_ENV=production`; it truncates first

- It also seeds avatars, the way a client would: ask for a presigned URL, PUT the bytes, then set `avatarRef` through `updateProfile`. No shortcut through the S3 client, so seeding exercises the same handshake the API offers. The key cannot live in `seed.json` for the same reason it is not a client's to choose — it carries a uuid that exists only once the upload is authorised. Uploads run after the transaction commits: holding one open across calls to storage would be a poor trade for a demo seeder. A runner with no `avatars/{userId}.png` simply has no avatar

**Done when** the service starts, serves all four operations end to end, answers `/health` and `/ready`, seeds, and stops cleanly — with `/ready` answering 503 for `SHUTDOWN_DRAIN_MS` while still accepting, before the server closes.

### 6 — Packaging

Until here the service runs on a laptop. This phase makes it an artifact.

- **Multi-stage `Dockerfile`** — a build stage running `npm ci` and `npm run build`, then a runtime stage on the same `node:24.22-alpine` with `npm ci --omit=dev`, carrying `dist/` and `drizzle/` and nothing else. Pinned to the minor, not floating: the image a teammate builds should be the image you built. Verified empty of `typescript`, `vitest`, `eslint`, `drizzle-kit`, `pino-pretty` and `ajv`
- **`.dockerignore` first** — without one, `.env` enters the build context and can reach the image. That is a credential leak, not a size problem
- Run as the image's own non-root `node` user
- **`HEALTHCHECK` against `/ready`**, not `/health` — compose's `depends_on: service_healthy` gates whether to send work, which is a readiness question. `/health` stays the liveness signal for whatever restarts containers
- The service joins `docker-compose.yml` beside Postgres, `depends_on` its healthcheck, so `docker compose up` is the whole demonstration
- **SIGTERM is load-bearing.** Docker signals PID 1, and Node installs no default handler there, so phase 5's graceful shutdown is what stands between `docker stop` and ten seconds of hanging followed by SIGKILL mid-request
- **Migrations are a separate one-shot run of the same image**, never automatic on boot — three replicas starting together would otherwise be three concurrent migrations against one schema. Same artifact, different command: `node dist/migrate.js`. In compose it is a service gated on Postgres being healthy, with the service gated on it having completed, so `docker compose up` is one command

  `src/migrate.ts` uses drizzle-orm's migrator rather than the `drizzle-kit` CLI, because drizzle-kit is a devDependency and the runtime image is installed with `--omit=dev`. `npm run db:migrate` and the integration harness both go through `infrastructure/migrations.ts`, so the migration code that ships is the code every test run exercises — pool budgets included

  **The budgets differ by purpose, and that matters.** `REQUEST_BUDGETS` caps a query at two seconds, which is right for a request and fatal for a migration: `CREATE INDEX` on a populated table would abort, and with the service gated on the migration completing, the stack would refuse to start. `MIGRATION_BUDGETS` has no query limit. Both are measured — a three-second statement succeeds under one and fails under the other

- **`stop_grace_period` must exceed `SHUTDOWN_DRAIN_MS` plus the close deadline**, or the container is killed mid-drain and the graceful shutdown is worse than none. Compose sets 20s against a 3s drain and a 10s deadline; the startup log prints the total because nothing inside the process can check the grace

- **Compose does not seed.** `db:seed` truncates first, and a demo stack that quietly empties the table on `up` is a bad default. Seeding stays `npm run db:seed`, run deliberately

**Done when** `docker compose up` brings up a healthy service against a healthy database, `docker stop` ends it without severing a request, and the image carries no development dependency — verified: migrate exits, the service reports healthy through the `/ready` HEALTHCHECK, it runs as uid 1000, `.env` is absent from the image, and `docker stop` takes the drain and no more.

### 7 — Avatar storage

domain.md §1 says the image lives in object storage owned by this service and only its key is stored here.

**MinIO** in `docker-compose.yml`, reached with `@aws-sdk/client-s3`. MinIO speaks the S3 API, so the same code runs against real S3 by changing an endpoint — the dependency is on a protocol, not a vendor. It is AGPL v3, so the tag is pinned by release rather than tracking `latest`.

The domain did not change. `avatarRef` is still a string with a §4 rule, which is the evidence the boundary was drawn in the right place. The port lives in `application/`, not `domain/`: unlike `ProfileRepository`, the domain never resolves an avatar key, so storing images is not a domain concept. Ports live in `application/ports/`, and that directory is the only thing `infrastructure/` may import from `application/` — as a type, never as a value. The zone was first written as "any type from application", which said more than it meant: nothing stopped an adapter importing a use case's input type and shaping itself around application concepts. Narrowing it to `ports/` makes the rule say what the sentence says.

The four decisions, taken:

- **Presigned upload, not proxied.** `POST /v1/profiles/{userId}/avatar-uploads` returns a short-lived URL and the key it will occupy; the client PUTs the image to MinIO directly and this service never handles image bytes. It also does not set `avatarRef` — the runner PATCHes it once the upload succeeds, so a failed upload leaves nothing pointing at an object that is not there, and changing a field stays `updateProfile`'s job
- **Public bucket, unguessable keys.** An avatar is a picture a runner chose to show other runners, so reads need no signature and can be cached. The key carries a uuid, so the URL is unguessable even though the bucket is open
- **`avatars/{userId}/{uuid}`.** A fresh uuid per upload, so replacing an avatar cannot collide with a cached copy of the old one. Grouping by `userId` is what pays for the next decision. The bucket is named for the service rather than for what is in it — `profile-service`, not `avatars` — because a bucket sharing the key's first segment makes every path-style URL read `/avatars/avatars/…` and leaves nowhere to put anything else this service might store
- **Best-effort delete, orphans tolerated.** `deleteProfile` asks storage to drop the runner's prefix after the row is gone; a storage failure is logged and the profile stays deleted, because the two cannot commit together and a profile that refuses to die is the worse outcome. Because keys are prefixed by `userId`, this needs no read of the profile first — `deleteProfile` is still one statement against the repository

  The same applies to *replacing* an avatar, which is the commoner case: a fresh uuid per upload means the previous object is unreachable the moment `avatarRef` changes. `updateProfile` drops the displaced key, after the write and best-effort for the same reason — the change is the thing that must not be lost. Cache-safe replacement would otherwise cost one orphan per edit rather than one per deletion

The authoritative cleanup for orphans would be a sweeper comparing keys against existing profiles, and that needs a bulk read, which §3 forbids. Buddy Discovery keeps its own copy of what we publish, so nothing needs a bulk read, and the sweeper stays blocked for that reason.

**Done when** an image can be uploaded, its key stored on the profile, and the image fetched back — verified end to end against real MinIO: create 201, authorise 201, PUT to MinIO 200, PATCH 200, anonymous GET 200 with identical bytes, delete 204 and the image then 404.

## Decisions taken

| | |
|---|---|
| **Authentication** | An access token from Identity, verified **locally** on every request — not trusted because a gateway forwarded it — the way Identity's and Notification's own middleware check theirs (ADR-0022): HS256 only, keyed by the secret every service shares, `ACCESS_TOKEN_SECRET`; issuer and audience are settings, `JWT_ISSUER` and `JWT_AUDIENCE`, defaulting to the team's `cant-run-alone-local` and `cant-run-alone-services`; `exp`, `iss`, `aud` and `sub` required, `sub` a UUID. The caller is the subject, lowercased. This reverses asymmetric verification against keys Identity published, with this service's own name as a constant audience: the team's Identity publishes no keys, signs HS256 and gives every service one audience, so no token it issued would ever have verified. The cost is the one the old entry named — whoever holds the secret can sign a token, this service included. Ownership is **access policy, not domain**: it lives in `openapi.yaml` as `bearerAuth`, the 401/403 responses and which form of the area a GET returns — the exact point to its owner, the cell to everyone else — and domain.md stays silent on who may act |
| **Time-of-day buckets** | Bangkok local time (UTC+7) |
| **The area** | One private point on the map, never a place name. Other runners see only its cell, the nearest point on a 0.01° grid (≈ 1.1 km). ADR-0016 left the cell scheme open: a square grid needs no library in `domain/`, and Buddy Discovery ranks on the cell's centre whatever made it |
| **Profile fields** | The team glossary's (`architecture-notes.md`): pace range, usual distance, experience, area, availability and gear, with display name, bio, avatar, birth year and gender. `volume` and `preferredDistances` are gone — no team document names them and nothing read them. A range, not one pace, because FR-4.2 ranks on overlap; a single pace survived migration 0002 as a range of zero width. Usual distance is whole metres up to 50 km, Run Scheduling's limit for a run. `birthYear` is optional: nothing required it, and the PDPA wants a stated purpose for what is collected (NFR-4.3) — it is kept, with `gender`, for future age and gender matching |
| **Field visibility** | FR-2.8. A runner hides fields with `hiddenFields`, sent at create or through PATCH like any set — PUT is create-only and PATCH merges, so leaving it out reveals nothing, and no separate endpoint is needed. Everything is public until hidden; `userId`, `displayName`, `avatarRef` and the area cell cannot be hidden. The rule has one home, `Profile.publicCard()`: other runners' GET and `ProfileUpdated`'s `card` both serialise it, and a unit test pins the two serialisations equal. Hidden means hidden from runners, not from matching: `ProfileUpdated`'s `matching` carries pace range, experience and preferred run times even when hidden, and Buddy Discovery should rank on them, never filter |
| **Probes** | Two, because they answer different questions. Liveness asks whether the process is wedged and its failure means *restart*, so `/health` checks nothing and keeps answering 200 while draining — failing it during a deliberate shutdown would have the orchestrator restart a process that is already leaving. Readiness asks whether traffic should come here and its failure means *route elsewhere*, so `/ready` does check the database and answers 503 while draining. This reverses an earlier decision to have liveness only; the drain window is what changed it. The grace period between `/ready` turning 503 and the server refusing connections is `SHUTDOWN_DRAIN_MS`. It defaults to **0**, and without it the 503 is unobservable — the socket closes in the same tick, measured. Zero keeps Ctrl-C instant in development, where nothing polls; anything that routes traffic on `/ready` sets a few seconds. An orchestrator's `preStop` delay does the same job and can be used instead |
| **Boundary enforcement** | ESLint import zones, failing the build |
| **Imports** | Relative specifiers carry `.ts` and TypeScript rewrites them to `.js`. The usual convention spells the extension `.js` in source; it was rejected for naming a file that does not exist. `moduleResolution: "nodenext"` makes a missing extension a compile error |
| **Build** | `tsc` to `dist/`, no bundler. Native type stripping means `node src/index.ts` runs the source unaided, so `tsx` was dropped — `node --watch` covers the dev loop and dev then resolves modules the way production does. Both esbuild and `tsx` itself stay in the tree regardless — drizzle-kit and vite pull them — so the gain is one fewer tool of ours to reason about, not fewer bytes |
| **Packaging** | A multi-stage image, and the service alongside Postgres in `docker-compose.yml`. Schema migrations run as a separate command, never on boot |
| **Contract enforcement** | Responses are validated against `openapi.yaml` in the integration tests, and the events this service sends against its `webhooks` schemas: the code must obey the document. Deliberately not the reverse — generating types *from* the spec would put a derived artifact upstream of the implementation, and generating the spec *from* the code would cost the prose, the rationale and the traceability to §3 and §4 that make it worth publishing at all. Consumer-driven contracts wait for a consumer |
| **Test database** | Integration tests start their own PostgreSQL through Testcontainers rather than borrowing the compose one. The argument is the failure mode: a self-provisioned database fails loudly and identically for everyone, where a shared one can quietly pass against the wrong server — a teammate's own Postgres already holding port 5432, say. It also removes the onboarding steps a README would otherwise have to carry |
| **The development database** | Disposable, and deliberately not a named volume. `docker-compose.yml` declares none, so Postgres data lands in the anonymous volume its own image creates — which `docker compose down` discards, and that is precisely what `db:reset` is: `down` then `up`. Giving it a named volume reads like a tidy-up and is the opposite; measured, a row written before `down` survives into the next `up`, so `db:reset` would quietly stop resetting. Nothing here is worth keeping — the data is five fixture runners, `db:migrate` rebuilds the schema and `db:seed` reloads them in a second. A service whose local database must survive is a different decision, taken when there is something in it worth surviving |
| **npm hygiene** | Two blocks in `package.json` exist for reasons a tidy-up would erase. `overrides` pins a safe `esbuild` inside `drizzle-kit`'s dependency tree — delete it and `npm audit` reports 4 moderate advisories again. It also lifts `minimatch` to 11 and `glob` to 14 across the tree, past the majors that the latest `eslint`, `typescript-eslint` and `testcontainers`' `archiver` still declare — delete those two and 18 moderate advisories return. Under them ESLint lints the same files with the same zones and archiver packs the same entries; they come out once upstream declares the patched majors itself. `allowScripts` denies esbuild's `postinstall`: npm 11 refuses install scripts until approved, and this one has nothing to do, since the compiled binary arrives as an optional dependency. Denying rather than ignoring is about the signal — a warning printed on every install becomes wallpaper, and the next package that wants to run code at install time should stand out. `npm install-scripts approve esbuild` reverses it, which is what an install skipping optional dependencies would need. `@scarf/scarf` is denied for a different reason: `swagger-ui-dist` pulls it in only so its `postinstall` can report each install to scarf.sh, on by default and carrying the installer's IP. Nothing in Swagger UI loads it, so the denial costs nothing, and unlike leaving it pending it survives an `npm install-scripts approve --all` |
| **Logging** | Structured JSON on stdout, one correlation id per request, nothing shipped from inside the process. `pino` costs eleven transitive dependencies where `jose` costs zero; it is bought for the child logger, which is what makes a request traceable once Identity and Discovery are at the other end of it. `domain/` never logs — it throws, and the HTTP layer decides what that is worth saying |
| **Profile events** | After a create or change, `ProfileUpdated` carries the runner's public card — visibility applied, the area only as its cell — and the fields Buddy Discovery matches on; after a delete, `ProfileDeleted` carries none. CloudEvents 1.0, structured mode, JSON (Protocol Buffers stay with gRPC, per ADR-0007), described under `webhooks` in `openapi.yaml`. The three writing use cases publish through the `ProfileEvents` port after their write; the request awaits delivery — the synchronous version, a broker comes later — and a failure is logged with the request id and never fails the request (ADR-0019). Awaiting departs on purpose from ADR-0019's chosen option, whose publisher "must not wait on" a subscriber: a slow Buddy Discovery slows a runner's save by up to the delivery budget, and the broker version will not wait. Delivery: 1 000 ms per attempt, 3 attempts, waits of 200 then 400 ms; retried on network errors, timeouts, 408, 429 and 5xx; a 401 fetches a fresh token. The token is OAuth 2.0 client credentials from Identity, kept until 30 s before expiry (ADR-0014). `ProfileDeleted` and Identity's token endpoint are proposals to their owners. Off while `EVENT_SUBSCRIBERS` is empty |

## Deferred on purpose

- **Identity deleting a runner** — §1 names the orphaned profile and leaves it unhandled. Our events cannot fix it: Identity would have to publish a deletion, and no team document plans one — Identity publishes only `PhoneVerified` and `ContactChanged`. The trigger is Identity planning that event
- **Concurrent updates to one profile** — `ProfileRepository.update` writes the whole aggregate with no expected-version check, so two PATCHes that read the same profile and change different fields end with the later write reverting the earlier one, both answering 200. Since `updateProfile` began deleting the avatar it displaces, the same race costs more than an edit: if one request replaces the avatar while another holds a stale copy of the old key, the surviving profile can point at an object that has just been removed. `insert` and `update` are split precisely to keep §5's invariant off a check-then-write race; this identical window on the update path is not covered. The cheapest answer is a `version` column and an optimistic check. That was framed as "decide before phase 2's migration", which overstated it — phase 2 has shipped and a second migration is nearly free while this service holds no data anyone minds losing. That is the real trigger: the first data worth keeping
- **Whether `userId` may be normalised** — the aggregate trims it and stores the trimmed form, while `findById` and `delete` take the path parameter as given, so an id carrying whitespace creates a row that can never be read or removed. §1 says we are conformist and treat the id as a meaningless string, which argues for validating on the trimmed value and storing exactly what Identity gave us — but that reading is not confirmed with Identity yet. Normalise at every lookup or at none; today the two halves disagree. The same gap lets `getProfile('')` and `deleteProfile('')` reach the database with an empty key that §4 forbids outright
- **What a presigned upload is allowed to contain** — the presign carries a bucket and a key and nothing else, so for the five minutes it lives the holder can PUT any bytes of any length, and MinIO serves back whatever `Content-Type` they sent. Upload HTML and the storage origin hosts it.

  This is a direct consequence of choosing presigned uploads over proxying: the service deliberately never sees the bytes, so the signature is the only place a constraint can live. Signing `ContentType` against an allow-list of image types closes the half that matters and costs about 25 lines plus a request body on the avatar POST; signing `ContentLength` as well bounds cost. A presigned POST policy would give a real size *range* rather than an exact value, at the price of multipart uploads on the client.

  Not done, because getting a URL needs a verified token for the profile being written, the URL expires in 300 seconds, and every account is one we issued. The trigger is the first untrusted user, or the first time avatars are served from this service's own domain rather than the storage origin — at which point "it is a different origin" stops being the mitigation it currently is.
- **CI** — there is no remote for a workflow to run on and nobody else pushes, so there is nothing to gate. The trigger is the remote. What it would be worth then is not gatekeeping but a clean-room run of exactly what the team does — `npm ci`, typecheck, lint, test, `test:int`, build — catching the "works on the author's machine" failures, which land on them and never on us. `test:int` needs no CI-specific database, since the suite provisions its own. Once phase 6 exists, publishing the image matters more than any of it: the team would deploy a tag rather than build from source
- **Lost events** — delivery is awaited with three attempts, so a subscriber down past them loses the event (ADR-0019 accepts it). A lost `ProfileUpdated` heals at the runner's next change; a lost `ProfileDeleted` never does, and Buddy Discovery keeps a ghost candidate. The transactional outbox closes both — the event written in the same transaction as the change and relayed until accepted — and so does a broker, which `openapi.yaml` cannot describe: the event contract moves to AsyncAPI then. The trigger is the asynchronous version

## Definition of done

Each phase carries its own done-when. This is the bar for the service as a whole.

**A machine checks these.** On a clean checkout, with Docker running:

```
npm ci && npm run typecheck && npm run lint && npm test && npm run test:int && npm run build
```

- `lint` passing means the dependency rule held — no layer reached across a boundary
- `test:int` passing means every operation and every status in openapi.yaml was exercised, and every response was validated against the document itself
- `docker compose up` brings up a healthy service against a healthy database, and `docker stop` ends it without severing a request

**Only a person checks these.**

- domain.md still describes the model the code implements. Nothing verifies this, which is why it is the one that rots
- §2's words are the words in the code — class names, fields, tests, commits

**Not required.** A broker, the outbox and CI sit under **Deferred on purpose**. The service is done without them.
