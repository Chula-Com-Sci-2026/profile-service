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
| Quality | Vitest 5, unit, integration and component in separate configs; the integration suite provisions its own PostgreSQL and RabbitMQ with `@testcontainers/postgresql` and `@testcontainers/rabbitmq` 12, and the component suite builds the image and runs it beside its own PostgreSQL, RabbitMQ and MinIO with `testcontainers` 12. `openapi.yaml` is checked against real responses, and `profile-events.schema.json` against real events, by `ajv` 8 — with `ajv-formats` 3 for the event schema's formats — and `yaml` 2. None of those three is installed yet. ESLint 10 + typescript-eslint enforces the import zones |
| Build and packaging | `tsc` to `dist/`, no bundler; then a multi-stage Docker image, which is the unit of deployment |
| Integrations | **Object storage** — MinIO for photos, via `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, from Chainguard's image pinned by digest. **Profile events** — `ProfileUpdated` on RabbitMQ (ADR-0021), the team's `rabbitmq:4.3.6-management`, through a transactional outbox: `amqplib` 2, the client the team's Identity uses, over a normal AMQP connection with publisher confirms — not the management API Discovery publishes through. See **Profile events** |

Everything above is installed. Each arrived in the phase that first used it, never earlier — a dependency installed ahead of the code that exercises it is an unverified guess, and its version is stale by the time it matters.

They split along the line the container cares about: `hono`, `@hono/node-server`, `drizzle-orm`, `pg`, `zod`, `jose`, `pino`, `amqplib` and the two `@aws-sdk` packages ship inside it; everything else stays in the toolbox and is stripped by `npm ci --omit=dev`.

`exactOptionalPropertyTypes` keeps `undefined` out of the model. An optional key in an input — a save's `bio`, say — is *omitted*, never passed as `undefined`. A profile's unset field is `null`, the value the wire and the column carry too (domain.md §3). One value form from the request to the row is what lets the layers pass a field along without converting it.

This file is the only record of the stack and the layering rules — the why, at length. [README.md](../README.md) is the other half: what to type, short enough to read before you start. There is no `CLAUDE.md`.

## Layout and the one rule

```
src/
├─ domain/           entities, value objects, domain errors, repository interfaces
├─ application/      use cases, one file per use case
│  └─ ports/        contracts infrastructure implements — the one thing it may import from here
├─ infrastructure/   drizzle schema, repository implementation, db client, config
├─ interface/http/   hono routes, middleware, zod validators, mappers
├─ migrate.ts        one-shot command: apply the migrations
├─ republish-events.ts one-shot command: every profile's ProfileUpdated, again
└─ index.ts          composition root — the only file that knows every layer; like the commands, outside the zones
tests/
├─ unit/             no database, no network
└─ integration/      real PostgreSQL and RabbitMQ, serial; globalSetup starts the containers
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

`eslint.config.js` enforces this with per-directory `no-restricted-imports` zones, so a violation fails `npm run lint` with the layer's own rule as the message. The files directly under `src/` are outside the zones: `index.ts`, the composition root and the one place that knows every layer exists, and the two one-shot commands, which compose what they need the same way.

## Naming across layers

- camelCase in TypeScript and JSON, snake_case in the database. Mapping happens in `infrastructure/`, nowhere else
- kebab-case for file names, including files that export a single class — `area-cell.ts`, not `AreaCell.ts`. On macOS those two are the same file; on Linux they are not
- One name and one value form everywhere — a field is called the same in a request, the aggregate, domain.md, events, seeds and logs, and its column is that name in snake_case (`paceMin`, `pace_min`). Values are stored in the form the wire carries — `paceMin` is decimal minutes per kilometre from the request to the row — so no layer renames a field or converts a value, and units are stated in domain.md §4 and openapi.yaml. This replaced units carried by value objects (`Pace`, `UsualDistance`)
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

- One value object class — `AreaCell`, made from a `latitude` and a `longitude` and rounding them itself, so it has nothing to validate. Immutable, and compared by value
- Union types — `Experience`, `UsualDistance`, `HiddenField`. `as const` arrays plus `typeof X[number]`, so one declaration gives both a runtime list and the type
- `Profile` — the aggregate root. Validates its plain fields itself — `id`, `name`, `bio`, `paceMin`/`paceMax` (through `toPace`), `area`, `latitude`/`longitude`, `availability`, `gear`, `photoRef` (§4) — and is frozen. `id` is its identity. It builds its own public card, `publicCard()` — the one place field visibility is applied
- Each change returns a **new** frozen `Profile` rather than mutating: `Profile.create(id, content)` for the first save, then `save(content)`, `setFieldVisibility()`, `attachPhoto()` and `removePhoto()` — the team's operations, so the aggregate speaks domain.md §3's language. What a left-out field means and what a null means are domain rules, so they are decided here and not in `application/`. Each is one `revision` higher; `create` starts at 1
- Domain errors — `ProfileNotFoundError`, `ProfileAlreadyExistsError`, `ConcurrentChangeError`, and one for a field that breaks a §4 rule. Never an HTTP status in this layer
- `ProfileRepository` interface — `findById`, `findAll`, `insert`, `update`. `insert` and `update` are separate so §5's invariant is enforced by the primary key, not by a check-then-write race. **Reads report absence, writes raise conflicts**: `findById` returns `Profile | null`, because a missing profile is a normal result of a query — treating it as an error is policy, and policy belongs to the use case. `insert` throws `ProfileAlreadyExistsError` on the primary key, and `update` throws `ConcurrentChangeError` when the stored revision is no longer the one the change was made from (§5). `findAll` is for sending every profile's event again, and for the temporary search

**Done when** every rule in §4 has a unit test that runs with no database, including the rejections.

### 2 — Infrastructure

- Drizzle schema at `src/infrastructure/schema.ts` — `drizzle.config.ts` already points there. Two tables: `profiles` — `id uuid PRIMARY KEY`, Identity's id, one row per profile, no surrogate id — and `outbox`, one row per event (see **Profile events**)
- Fifteen columns, one per §3 field under its own name in snake_case — `pace_min`, `latitude`, `usual_distance` — with `double precision` for the pace and the point, which round-trips a JavaScript number exactly. `NOT NULL` on the required fields and on `hidden_fields`; an unset optional field is SQL `NULL`, gear included, since that is what the wire carries. `text` for the unions, not Postgres `enum` — altering an enum is a migration, altering a check is not
- Collections stay in the row as `jsonb`. Nothing queries them — the temporary search reads every profile and filters in memory — so per-member indexes and child tables buy nothing, and one row keeps "loaded and saved as one unit" literal
- The hidden set is normalised on write into declared order (`bio` before `gear`), never alphabetical. Storage is then deterministic and tests can assert literal arrays. `gear` has no declared order, so it keeps the runner's, with duplicates collapsed
- `npm run db:generate` for the migration, committed to `drizzle/`. It creates `drizzle/meta/` itself — an *empty* `meta/` makes it fail on a missing `_journal.json`, so never create that folder by hand. **Name every migration** — `npx drizzle-kit generate --name=create_profiles`. Left alone it picks an adjective and a Marvel character, which tells a reader nothing; the `0000_` prefix is what orders them, and `meta/_journal.json` records the tag, so renaming afterwards means editing the filename and the journal together
- `DrizzleProfileRepository implements ProfileRepository`. This is also where a driver error becomes a domain one: a unique violation on `id`, SQLSTATE `23505`, is caught here and rethrown as `ProfileAlreadyExistsError`, so nothing above this layer ever sees a `pg` error
- A mapper both ways. It renames nothing — the schema declaration names each column for its field — but **row → domain is a boundary** — every union and value object is re-validated on the way in, because §4's rules live in TypeScript and the table enforces none of them
- **Integration tests bring their own database.** A `globalSetup` starts `postgres:16-alpine`, and `rabbitmq:4.3.6-management` beside it, through Testcontainers, applies the migrations, hands the URL to the suite, and stops the container afterwards. Between tests, `TRUNCATE profiles, outbox` — two tables need nothing cleverer. `docker-compose.yml` is untouched and still serves `npm run dev` and `db:seed`

  The consequence worth having: **`git clone && npm ci && npm run test:int` passes on a machine that has never seen this project** — no port to free, no database to create by hand, no second environment variable, and the same command in CI as on a laptop. It asks one thing in return, that Docker is running, which every option here asks anyway. Two notes: the image tag appears in both `docker-compose.yml` and the setup file and the two must move together, and `vitest.int.config.ts` no longer needs its `.env` load for `DATABASE_URL`, since the container supplies it

**Done when** repository integration tests pass against real PostgreSQL — not a mock, not sqlite. Include the unique-violation path: driver errors may be wrapped, so find the SQLSTATE rather than assuming its depth.

### 3 — Application

One file per use case, named exactly for domain.md §3's operations:

```
saveProfile   setFieldVisibility   createPhotoUpload   attachPhoto   removePhoto   getProfile   getPublicProfile   searchRunners   republishProfiles
```

Each reads through the repository interface, and each that changes a profile writes through the `UnitOfWork` port — its write and its event in one transaction — never a concrete class. `saveProfile` takes a profile's content: the runner's answers replace what was there, and our two additions, usual distance and gear, are kept when left out. Those are domain rules, so they belong to `Profile.save()` from phase 1; the use case decides only whether this is the first save.

A missing profile is an **exception, never a `null` return**: every operation on an existing profile throws `ProfileNotFoundError`, which is what phase 4 maps to 404. Returning null instead would move a domain fact — *this runner has no profile* — out to the edge for the HTTP layer to reinterpret.

**Done when** each use case has a test using an in-memory repository, with no database. Helpers and test doubles live beside the suite that uses them — there is no shared `support/` folder.

### 4 — Interface / HTTP

Everything here comes from openapi.yaml.

The middleware in this phase are factories. The base logger and the config object they need belong to phase 5's composition root, so this phase declares what it requires and takes it as an argument rather than constructing it — which is why the dependency appears to point forward.

Order is error handler outermost, then request context, then auth, then routes — the only arrangement in which the error handler can catch what the others throw. **Auth is mounted on `/api/v1/*`, not globally**, so `/up` never reaches it. That mirrors openapi.yaml, where `/up` is the one operation carrying `security: []`, and unlike relying on registration order it survives someone reshuffling the routes.

- Hono routes for the operations under `/api/v1/me/profile`, `GET /api/v1/runners/:id` and the temporary search, `GET /api/v1/runners`, plus the two operational endpoints — `GET /up`, which touches nothing, and `GET /ready`, which pings the database through an injected probe. Both are public: an orchestrator and a load balancer have no token
- One middleware, first in the chain, establishes the request context: it reads `X-Correlation-Id`, keeps it when it is a UUID (lowercased) and otherwise generates one (`node:crypto` — no dependency), echoes it on every response, and puts `log = base.child({ correlationId })` on the context. Every line written while serving that request then carries the id, with no logger threaded through call signatures. `hono/logger` exists but writes prose rather than JSON, so it is not used
- One middleware verifies the bearer JWT from Identity **locally** with `jose` and produces a typed `caller` from its subject. No route, use case or domain object ever sees a header or a token. There is no ownership to compare: "me" in every `/api/v1/me` path is the caller

  ```ts
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ['HS256'], issuer, audience, requiredClaims: ['exp', 'iss', 'aud', 'sub'],
  })
  c.set('caller', { id: payload.sub.toLowerCase() }) // once the subject is known to be a UUID
  ```

  The same check as Identity's own middleware and Notification's
- Zod validators matched to the request bodies — shape only; the rules live in the domain. A body's unknown keys are stripped, not refused, as the team's contract does. Zod infers an optional field as `T | undefined`, which `exactOptionalPropertyTypes` refuses to hand to the domain — so the mapper omits the key, `...(v !== undefined && { k: v })`, rather than forwarding an `undefined`
- A view mapper: domain object → JSON, every key always written and `null` when unset. Two shapes: the owner's view — every field, the exact point and `hiddenFields` — and `profile.publicCard()` serialised, for everyone else and for the owner reading their own card
- Error middleware: domain error → the error format under **Errors** in Decisions taken — and the statuses openapi.yaml enumerates: **401** no or invalid token, **404** no such profile, **422** a malformed body or a value that breaks a §4 rule, **500** otherwise, and **503** when a photo route cannot reach object storage. A 500 is the one response that deliberately tells the client nothing useful, so `log.error({ err })` here is the only record that the failure happened at all
- **The contract is asserted, not promised.** A helper loads `openapi.yaml` once, resolves the schema for an operation and a status, and validates the response body:

  ```ts
  expectContract('saveProfile', 200, res)
  ```

  Every test gains a line, and because this phase already covers every operation and every status, the document is checked in full. OpenAPI 3.1 *is* JSON Schema 2020-12, so Ajv's 2020 build reads the schemas as they stand — `unevaluatedProperties`, the `allOf` with sibling `required`, and the `$ref`s between schemas all resolve — with strict mode off, since the document carries OpenAPI keywords Ajv has no opinion about. One further test asserts the reverse direction: every `operationId` in the document is exercised by at least one test, which is what catches a spec describing an endpoint nobody built

**Done when** integration tests cover every operation and every status openapi.yaml documents, and every one of those responses is validated against the document itself.

### 5 — Wiring and seed

- `src/index.ts` — composition root: config from environment, the base logger, one pool, routes, listen. It **calls** `infrastructure/`'s `config.ts` and `database.ts` rather than building either itself — `pg` and `drizzle-orm` stay behind that boundary, and "one pool" means one instance, not one construction site. The zones exempt the files directly under `src/` — this one and the two one-shot commands — so these are where "the ORM appears in `infrastructure/` and nowhere else" is on the honour system; the exemption is there to let the root see every layer, not to let it reach past one. The logger is constructed here and nowhere else — level from configuration, `redact` covering the `authorization` header so a bearer token never reaches a log line, and plain JSON to stdout. Shipping, rotating and prettifying are somebody else's process — the `dev` script gains a `| pino-pretty` in this phase, a pipe rather than a transport, since a transport would run pretty-printing inside this process
- Config read once at startup; a missing `DATABASE_URL` or `ACCESS_TOKEN_SECRET` fails there, not on the first request. Every setting `.env.example` carries is validated in `config.ts` rather than trusted, `LOG_LEVEL` defaulting to `info` and set to `silent` under test. `JWT_ISSUER` and `JWT_AUDIENCE` default to the team's `cant-run-alone-local` and `cant-run-alone-services`
- Graceful shutdown: stop accepting, close idle connections, stop the event relay and close the broker connection, end the pool, and give up after a deadline rather than hanging
- `scripts/seed.ts` — reads `scripts/seed.json` and saves through `saveProfile` inside one transaction, so a row that breaks §4 fails at seed time rather than landing in the table, and each runner's `ProfileUpdated` is in the outbox when the rows commit. Refuses to run when `NODE_ENV=production`; it truncates `profiles` and `outbox` together first, so an old unsent event cannot go out after a reset

- It also seeds photos, the way a client would: ask `createPhotoUpload` for a presigned URL, PUT the bytes, then `attachPhoto`. No shortcut through the S3 client, so seeding exercises the same handshake the API offers. The key cannot live in `seed.json` for the same reason it is not a client's to choose — it carries a uuid that exists only once the upload is authorised. Uploads run after the transaction commits: holding one open across calls to storage would be a poor trade for a demo seeder. A runner with no `photos/{id}.png` simply has no photo. When storage cannot be reached the seed warns once and seeds the runners without photos, rather than stopping at the first upload

**Done when** the service starts, serves all four operations end to end, answers `/up` and `/ready`, seeds, and stops cleanly — with `/ready` answering 503 for `SHUTDOWN_DRAIN_MS` while still accepting, before the server closes.

### 6 — Packaging

Until here the service runs on a laptop. This phase makes it an artifact.

- **Multi-stage `Dockerfile`** — a build stage running `npm ci` and `npm run build`, then a runtime stage on the same `node:24.22-alpine` with `npm ci --omit=dev`, carrying `dist/` and `drizzle/` and nothing else. Pinned to the minor, not floating: the image a teammate builds should be the image you built. Verified empty of `typescript`, `vitest`, `eslint`, `drizzle-kit`, `pino-pretty` and `ajv`
- **`.dockerignore` first** — without one, `.env` enters the build context and can reach the image. That is a credential leak, not a size problem
- Run as the image's own non-root `node` user
- **`HEALTHCHECK` against `/ready`**, not `/up` — compose's `depends_on: service_healthy` gates whether to send work, which is a readiness question. `/up` stays the liveness signal for whatever restarts containers
- The service joins `docker-compose.yml` beside Postgres, `depends_on` its healthcheck, so `docker compose up` is the whole demonstration
- **SIGTERM is load-bearing.** Docker signals PID 1, and Node installs no default handler there, so phase 5's graceful shutdown is what stands between `docker stop` and ten seconds of hanging followed by SIGKILL mid-request
- **Migrations are a separate one-shot run of the same image**, never automatic on boot — three replicas starting together would otherwise be three concurrent migrations against one schema. Same artifact, different command: `node dist/migrate.js`. In compose it is a service gated on Postgres being healthy, with the service gated on it having completed, so `docker compose up` is one command

  `src/migrate.ts` uses drizzle-orm's migrator rather than the `drizzle-kit` CLI, because drizzle-kit is a devDependency and the runtime image is installed with `--omit=dev`. `npm run db:migrate` and the integration harness both go through `infrastructure/migrations.ts`, so the migration code that ships is the code every test run exercises — pool budgets included

  **The budgets differ by purpose, and that matters.** `REQUEST_BUDGETS` caps a query at two seconds, which is right for a request and fatal for a migration: `CREATE INDEX` on a populated table would abort, and with the service gated on the migration completing, the stack would refuse to start. `MIGRATION_BUDGETS` has no query limit. Both are measured — a three-second statement succeeds under one and fails under the other

- **`stop_grace_period` must exceed `SHUTDOWN_DRAIN_MS` plus the close deadline**, or the container is killed mid-drain and the graceful shutdown is worse than none. Compose sets 20s against a 3s drain and a 10s deadline; the startup log prints the total because nothing inside the process can check the grace

- **Compose does not seed.** `db:seed` truncates first, and a demo stack that quietly empties the table on `up` is a bad default. Seeding stays `npm run db:seed`, run deliberately

**Done when** `docker compose up` brings up a healthy service against a healthy database, `docker stop` ends it without severing a request, and the image carries no development dependency — verified: migrate exits, the service reports healthy through the `/ready` HEALTHCHECK, it runs as uid 1000, `.env` is absent from the image, and `docker stop` takes the drain and no more.

### 7 — Photo storage

domain.md §1 says the image lives in object storage owned by this service and only its key is stored here.

**MinIO** in `docker-compose.yml`, reached with `@aws-sdk/client-s3`. MinIO speaks the S3 API, so the same code runs against real S3 by changing an endpoint — the dependency is on a protocol, not a vendor. MinIO stopped publishing images in October 2025, and quay.io no longer serves the old tags, so the image is Chainguard's build, the one the team's integration stack runs. It is AGPL v3, so the image is pinned by digest rather than tracking `latest`.

The domain did not change. `photoRef` is still a string with a §4 rule, which is the evidence the boundary was drawn in the right place. The port lives in `application/`, not `domain/`: unlike `ProfileRepository`, the domain never resolves a photo key, so storing images is not a domain concept. Ports live in `application/ports/`, and that directory is the only thing `infrastructure/` may import from `application/` — as a type, never as a value. The zone was first written as "any type from application", which said more than it meant: nothing stopped an adapter importing a use case's input type and shaping itself around application concepts. Narrowing it to `ports/` makes the rule say what the sentence says.

The four decisions, taken:

- **Presigned upload, not proxied.** `POST /api/v1/me/profile/photo-uploads` returns a short-lived URL and the key it will occupy; the client PUTs the image to MinIO directly and this service never handles image bytes. It also does not set `photoRef` — the runner attaches it, `PUT /api/v1/me/profile/photo`, once the upload succeeds, so a failed upload leaves nothing pointing at an object that is not there. Attaching checks that the object is there, and asking for a link checks that storage answers (the **Photos** decision)
- **Public bucket, unguessable keys.** A photo is a picture a runner chose to show other runners, so reads need no signature and can be cached. The key carries a uuid, so the URL is unguessable even though the bucket is open
- **`photos/{id}/{uuid}`.** A fresh uuid per upload, so replacing a photo cannot collide with a cached copy of the old one. Grouping by `id` is what lets storage refuse a key that is not the runner's. The bucket is named for the service rather than for what is in it — `profile-service`, not `photos` — because a bucket sharing the key's first segment makes every path-style URL read `/photos/photos/…` and leaves nowhere to put anything else this service might store
- **Best-effort delete, orphans tolerated.** A fresh uuid per upload means a replaced photo's object is unreachable the moment `photoRef` changes, and a removed one's as soon as it is detached. `attachPhoto` and `removePhoto` drop the displaced key after the write, best effort: storage and the database cannot commit together, and the change is the thing that must not be lost, so a storage failure is logged as an orphan. Profiles themselves are never deleted (account deletion is the team's phase 2)

The authoritative cleanup for orphans would be a sweeper comparing keys against `ProfileRepository.findAll()`. It is not built: an orphan costs storage, never correctness, and each one is logged.

**Done when** an image can be uploaded, its key stored on the profile, and the image fetched back — verified end to end against real MinIO: create 201, authorise 201, PUT to MinIO 200, PATCH 200, anonymous GET 200 with identical bytes, delete 204 and the image then 404.

## Decisions taken

| | |
|---|---|
| **Authentication** | An access token from Identity, verified **locally** on every request — not trusted because a gateway forwarded it — the way Identity's and Notification's own middleware check theirs (ADR-0022): HS256 only, keyed by the secret every service shares, `ACCESS_TOKEN_SECRET`; issuer and audience are settings, `JWT_ISSUER` and `JWT_AUDIENCE`, defaulting to the team's `cant-run-alone-local` and `cant-run-alone-services`; `exp`, `iss`, `aud` and `sub` required, `sub` a UUID. The caller is the subject, lowercased. This reverses asymmetric verification against keys Identity published, with this service's own name as a constant audience: the team's Identity publishes no keys, signs HS256 and gives every service one audience, so no token it issued would ever have verified. The cost is the one the old entry named — whoever holds the secret can sign a token, this service included. The runner is always the caller: every route under `/api/v1/me` acts on the token subject's own profile, so there is no ownership check and no 403, and `GET /api/v1/runners/{id}` gives anyone — its owner included — the public card. Who may act stays out of domain.md. This reverses ownership as a comparison between the caller and a `userId` in the path |
| **The area** | Two things: the name of a place a runner chooses (`area`, such as "Lumphini area", shown to everyone) and a private point (`latitude`, `longitude`). Other runners see only the point's cell, the nearest point on a 0.01° grid (≈ 1.1 km), worked out when asked for and never stored. ADR-0016 left the cell scheme open: a square grid needs no library in `domain/`, and Buddy Discovery ranks on the cell's centre whatever made it. The aggregate carries the point as two plain fields rather than a value object, so it has the same names everywhere; `AreaCell` stays a value object made from them. This reverses "one private point, never a place name": the team's contract and frontend show a place name, and showing it reveals nothing NFR-4.1 protects |
| **Profile fields** | The team's, under the names and values its Profile contract and frontend use, one name and one value form from the wire to the column — the column is the same name in snake_case: `id`, `name`, `bio`, `paceMin`/`paceMax`, `experience`, `area`, `latitude`/`longitude`, `availability`, `usualDistance`, `gear`, `photoRef`, `hiddenFields` (domain.md §4). Name, pace, experience, area, the point and availability are required — the team's profile form requires them, and UC-02 needs pace, area and availability to match on; bio, usual distance, gear and the photo are optional. Pace is decimal minutes per kilometre kept to the nearest second, the contract's own unit. Experience is stored as the label the frontend shows, `Beginner`. Usual distance is one of the frontend form's three bands, stored as its labels. Availability is the contract's free text: structure is worth having only once something computes on it (FR-4.1, FR-4.2), and free text can be made structured later, not the reverse. An unset field is `null` everywhere, gear included. This reverses the earlier model: `displayName` up to 50 characters, a 500-character bio, a pace range in whole seconds, 150–900, behind `Pace` and `PaceRange` value objects, usual distance in metres, lowercase experience, preferred run times as days and six time-of-day buckets, an absent unset scalar and an empty unset set, and `birthYear` and `gender` — no team document or screen names those two, so they go rather than wait for a purpose. With one name everywhere, no mapper renames a field and no edge converts a value |
| **Field visibility** | FR-2.8. A runner hides fields through their own operation, `setFieldVisibility()` at `PUT /api/v1/me/profile/visibility`, which replaces the set; a save never touches it, so saving can never reveal anything. The names are `bio`, `pace` (both ends), `availability`, `experience`, `usualDistance` and `gear`; `id`, `name`, `area`, the cell and the photo are always shown. The rule has one home, `Profile.publicCard()`: `GET /api/v1/runners/{id}` — even for the card's owner — and `ProfileUpdated` both serialise it, and a unit test pins the two serialisations equal. Every key of the card is always present, and a hidden or unset field is `null`. Hidden means hidden from matching too: nothing hidden leaves the service. This reverses hiding at create or through PATCH, a card that left a hidden field out, and `ProfileUpdated`'s `matching`, which sent pace, experience and run times even when hidden — a search that filters on a field reveals it, and the team's frontend renders `null` as it renders a missing field |
| **Photos** | A runner's photo (FR-2.1) lives in object storage — MinIO, through the S3 API — and the profile holds only its key, `photoRef`. `photoUrl`, its public address, `{OBJECT_STORAGE_PUBLIC_ENDPOINT}/{OBJECT_STORAGE_BUCKET}/{photoRef}`, is worked out wherever a card is serialised and never stored; the domain never sees it. Three routes under `/api/v1/me/profile`: `POST photo-uploads` signs a short-lived upload link for a fresh key `photos/{id}/{uuid}`, `PUT photo` attaches it, `DELETE photo` removes it. The upload link first checks that storage answers, and attaching checks that the key is the runner's and the object was uploaded; when storage cannot be asked, both answer 503 `storage_unavailable`. Without the first check a browser's upload would fail later with a network error the frontend cannot explain; without the second, a broken client could attach a missing file and every viewer would see a broken image. A replaced or removed photo's object is deleted best-effort after the write; a failure is logged as an orphan. Storage being down costs only photos: nothing else asks it, and its calls have a 2 s budget so a dead store answers rather than hangs. This reverses phase 7's naming and handshake: `avatarRef`, `avatars/{userId}/` and setting the key through PATCH become `photoRef`, `photos/{id}/` and the attach route — FR-2.1 says photo, and the team frontend's Avatar is the initials circle — and an upload link that was signed without asking storage now asks |
| **Probes** | Two, because they answer different questions. Liveness asks whether the process is wedged and its failure means *restart*, so `/up` checks nothing and keeps answering 200 while draining — failing it during a deliberate shutdown would have the orchestrator restart a process that is already leaving. Readiness asks whether traffic should come here and its failure means *route elsewhere*, so `/ready` does check the database and answers 503 while draining. This reverses an earlier decision to have liveness only; the drain window is what changed it. The grace period between `/ready` turning 503 and the server refusing connections is `SHUTDOWN_DRAIN_MS`. It defaults to **0**, and without it the 503 is unobservable — the socket closes in the same tick, measured. Zero keeps Ctrl-C instant in development, where nothing polls; anything that routes traffic on `/ready` sets a few seconds. An orchestrator's `preStop` delay does the same job and can be used instead. Liveness answers at `/up`, the path every team service uses for it; it was `/health`, and only the path changed |
| **Boundary enforcement** | ESLint import zones, failing the build |
| **Imports** | Relative specifiers carry `.ts` and TypeScript rewrites them to `.js`. The usual convention spells the extension `.js` in source; it was rejected for naming a file that does not exist. `moduleResolution: "nodenext"` makes a missing extension a compile error |
| **Build** | `tsc` to `dist/`, no bundler. Native type stripping means `node src/index.ts` runs the source unaided, so `tsx` was dropped — `node --watch` covers the dev loop and dev then resolves modules the way production does. Both esbuild and `tsx` itself stay in the tree regardless — drizzle-kit and vite pull them — so the gain is one fewer tool of ours to reason about, not fewer bytes |
| **Packaging** | A multi-stage image, and the service alongside Postgres in `docker-compose.yml`. Schema migrations run as a separate command, never on boot |
| **Contract enforcement** | Responses are validated against `openapi.yaml` in the integration tests, and the events this service sends against `docs/profile-events.schema.json`: the code must obey the document. Deliberately not the reverse — generating types *from* the spec would put a derived artifact upstream of the implementation, and generating the spec *from* the code would cost the prose, the rationale and the traceability to §3 and §4 that make it worth publishing at all. Consumer-driven contracts wait for a consumer. The event contract is a JSON Schema in the team's format (`buddy-events.schema.json`: draft 2020-12, the envelope with `eventType` and `payload` constrained) and stands alone — the exchange, the routing key, at-least-once delivery, the revision rule and the republish command are in its descriptions — because it is the file the team's contracts repository will carry. This reverses describing the events under `webhooks` in `openapi.yaml`, and the plan to move them to AsyncAPI with a broker: a RabbitMQ event has no HTTP operation for OpenAPI to describe, and nobody on the team uses AsyncAPI |
| **Test database** | Integration tests start their own PostgreSQL through Testcontainers rather than borrowing the compose one. The argument is the failure mode: a self-provisioned database fails loudly and identically for everyone, where a shared one can quietly pass against the wrong server — a teammate's own Postgres already holding port 5432, say. It also removes the onboarding steps a README would otherwise have to carry |
| **The development database** | Disposable, and deliberately not a named volume. `docker-compose.yml` declares none, so Postgres data lands in the anonymous volume its own image creates — which `docker compose down` discards, and that is precisely what `db:reset` is: `down` then `up`. Giving it a named volume reads like a tidy-up and is the opposite; measured, a row written before `down` survives into the next `up`, so `db:reset` would quietly stop resetting. Nothing here is worth keeping — the data is seven fixture runners, `db:migrate` rebuilds the schema and `db:seed` reloads them in a second. A service whose local database must survive is a different decision, taken when there is something in it worth surviving |
| **npm hygiene** | Two blocks in `package.json` exist for reasons a tidy-up would erase. `overrides` pins a safe `esbuild` inside `drizzle-kit`'s dependency tree — delete it and `npm audit` reports 4 moderate advisories again. It also lifts `minimatch` to 11 and `glob` to 14 across the tree, past the majors that the latest `eslint`, `typescript-eslint` and `testcontainers`' `archiver` still declare — delete those two and 18 moderate advisories return. Under them ESLint lints the same files with the same zones and archiver packs the same entries; they come out once upstream declares the patched majors itself. `allowScripts` denies esbuild's `postinstall`: npm 11 refuses install scripts until approved, and this one has nothing to do, since the compiled binary arrives as an optional dependency. Denying rather than ignoring is about the signal — a warning printed on every install becomes wallpaper, and the next package that wants to run code at install time should stand out. `npm install-scripts approve esbuild` reverses it, which is what an install skipping optional dependencies would need. `@scarf/scarf` is denied for a different reason: `swagger-ui-dist` pulls it in only so its `postinstall` can report each install to scarf.sh, on by default and carrying the installer's IP. Nothing in Swagger UI loads it, so the denial costs nothing, and unlike leaving it pending it survives an `npm install-scripts approve --all` |
| **Logging** | Structured JSON on stdout, one correlation id per request, nothing shipped from inside the process. The id travels as `X-Correlation-Id`, the header the team's services use (Notification; NFR-7.4): a UUID a caller sends is kept, lowercased, and anything else is replaced by a fresh one; it is echoed on every response, written on every log line of the request as `correlationId`, and repeated in error bodies. This replaces reading `traceparent` or `X-Request-Id` and keeping any value: an id that is always a UUID is one every service can join on, and a caller can no longer write arbitrary text into our logs. `pino` costs eleven transitive dependencies where `jose` costs zero; it is bought for the child logger, which is what makes a request traceable once Identity and Discovery are at the other end of it. `domain/` never logs — it throws, and the HTTP layer decides what that is worth saying |
| **Errors** | Every error is `application/json` `{code, message, correlationId, fieldErrors?}` — the team frontend's `ApiErrorBody`. `code` is stable lowercase snake_case for code to branch on: `unauthorized` 401, `profile_not_found` and `not_found` 404, `validation_failed` 422, `internal_error` 500, `storage_unavailable` 503 (a photo route that cannot reach object storage). `message` is prose, never parsed. `fieldErrors` is one message per field, keyed by its name in the request, on a 422 when a field can be named: every malformed field at once, but only the first broken §4 rule, because the domain throws on the first and collecting them all would restructure every value object for little gain. A malformed body is a 422 as well — the 400/422 split meant something to RFC 9457's readers and nothing to this frontend. This reverses RFC 9457 problem+json: the frontend reads `code` and `message`, and so do the team's Identity and Reputation. `forbidden` 403 and `profile_already_exists` 409 went with ownership checks and create-only saves |
| **Profile events** | After every change — a save, a visibility change, a photo attached or removed — `ProfileUpdated` goes out on RabbitMQ, carrying the runner's public card (visibility applied, a hidden field as `null`, the area only as its cell) and the profile's `revision`. The envelope is the team's (`events.md`): `eventId`, `eventType`, `version`, `occurredAt`, `correlationId`, `payload`. The change and its event commit together: a writing use case runs through the `UnitOfWork` port, and `ProfileEvents.updated()` writes the event to the `outbox` table in the same transaction, so a save never waits on the broker and a crash cannot keep one without the other. A relay in the service sends unsent rows every 2 s, oldest first and one at a time, stopping at the first failure so a runner's events never overtake each other, through the one sender `EVENT_SENDER` picks: `rabbitmq`, or `none`, the default, under which rows wait, so a clone needs no broker. The RabbitMQ sender uses a confirm channel, declares `cra.events` (topic, durable) on every connect and publishes with routing key = `eventType`, `mandatory`, persistent, `messageId` = `eventId`; a row is sent only once the broker confirmed it and did not return it, so until a consumer binds a queue every row stays. Profile connects as its own broker user, `profile`, which may configure and write `cra.events` and nothing else. RabbitMQ down costs only delivery: startup does not wait for it, `/ready` does not ask it, and the relay logs once per outage. Sent rows keep their `published_at`; nothing cleans them up. `npm run events:republish` writes every profile's current card to the outbox again under its unchanged revision, for a consumer whose copy must be rebuilt. This reverses CloudEvents over synchronous, awaited REST POSTs with client-credentials tokens from Identity (ADR-0019, phase 1): the team chose RabbitMQ (ADR-0021), its consumers read `events.md`'s envelope, and no Identity issues service tokens. The sender interface stays, so REST is one adapter if the team ever picks it. `ProfileDeleted` went with deletion itself — account deletion is the team's phase 2 — and `matching` went because hidden means hidden from matching too |
| **Concurrent changes** | Every change to a profile raises its `revision` by one, and the write is conditional on the revision it was made from: `WHERE id = $id AND revision = $previous`. Of two changes made from the same revision only one is written; the other finds the row moved, re-reads the profile and makes its change again on the new one — correct because every write is a replace. A lost first-save race (two inserts, one primary key) retries the same way. Each attempt runs in a transaction of its own, because a unique violation aborts the transaction it happens in; inside the seed's transaction that is a savepoint. Three attempts, then a logged 500. `revision` doubles as the aggregate's version rather than adding a second number: it already rises with every change, and Buddy Discovery's copy relies on exactly that. This closes the deferred "Concurrent updates to one profile" with the answer it named |
| **Temporary search** | `GET /api/v1/runners`, `searchRunners()`, answers Buddy Discovery's search until its own is live, and then goes from the code and the contract: one use case, one route, one path. Discovery's `SearchRunners` calls it today with the runner's own token, so the caller is the runner searching; they need a profile and are left out of the answer. The parameters are the team contract's — `radiusKm`, `experience`, `pace`, `availability` — and any other, such as `verifiedOnly`, is ignored: Profile has nothing to verify by. They are read leniently, because Discovery's request is proto3 and an unset field arrives as `0` or `""`: a missing, empty or non-positive `radiusKm` is 10, an empty filter is off, and only a value that cannot be read is a 422. Distances are great-circle between area cells, never exact points (NFR-4.1, ADR-0016), so they are off by up to about a cell's half-diagonal at each end — which is what keeps repeated searches from pinpointing anyone. `distanceKm`, to one decimal, is the number both the radius and the order use, so an answer can be checked against itself. The filters read the public card, so a hidden field is `null` and fails a filter on it: hidden means hidden from matching here too. `pace` keeps runners whose range overlaps the caller's saved range, as the team's contracts describe, and `availability` is a case-insensitive "contains". The answer is a bare array, nearest first and then by `id`, because the team's frontend expects `Runner[]` and its gateway passes Discovery's answer through. Every search reads every profile through `findAll()` and filters in memory, with no index and no paging: the data is demo-sized and the route is meant to be deleted. This reverses, for now, "profiles cannot be listed or searched", which assumed Buddy Discovery already searched its own copy |

## Deferred on purpose

- **Identity deleting a runner** — §1 names the orphaned profile and leaves it unhandled. Our events cannot fix it: Identity would have to publish a deletion, and no team document plans one — Identity publishes only `PhoneVerified` and `ContactChanged`. The trigger is Identity planning that event
- **What a presigned upload is allowed to contain** — the presign carries a bucket and a key and nothing else, so for the five minutes it lives the holder can PUT any bytes of any length, and MinIO serves back whatever `Content-Type` they sent. Upload HTML and the storage origin hosts it.

  This is a direct consequence of choosing presigned uploads over proxying: the service deliberately never sees the bytes, so the signature is the only place a constraint can live. Signing `ContentType` against an allow-list of image types closes the half that matters and costs about 25 lines plus a request body on the photo-uploads POST; signing `ContentLength` as well bounds cost. A presigned POST policy would give a real size *range* rather than an exact value, at the price of multipart uploads on the client.

  Not done, because getting a URL needs a verified token for the profile being written, the URL expires in 300 seconds, and every account is one we issued. The trigger is the first untrusted user, or the first time photos are served from this service's own domain rather than the storage origin — at which point "it is a different origin" stops being the mitigation it currently is.
- **CI** — there is no remote for a workflow to run on and nobody else pushes, so there is nothing to gate. The trigger is the remote. What it would be worth then is not gatekeeping but a clean-room run of exactly what the team does — `npm ci`, typecheck, lint, test, `test:int`, build — catching the "works on the author's machine" failures, which land on them and never on us. `test:int` needs no CI-specific database, since the suite provisions its own. Once phase 6 exists, publishing the image matters more than any of it: the team would deploy a tag rather than build from source

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

**Not required.** CI sits under **Deferred on purpose**. The service is done without it.
