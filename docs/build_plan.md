# Build Plan — Profile Service

> Status: draft. [domain.md](./domain.md) is the spec and it is authoritative; [openapi.yaml](./openapi.yaml) is the HTTP contract. This file is the order of work.

Nothing is built yet. `src/`, `tests/` and `drizzle/` exist and are empty; the configuration, the two specs above and `scripts/seed.json` are the whole starting point.

## Stack

| | |
|---|---|
| Runtime | Node ≥ 22, ESM (`"type": "module"`) |
| Language | TypeScript `~6.0.3` — `strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. Tilde, not caret: `typescript-eslint` peers `<6.1.0` |
| HTTP | Hono 4 + `@hono/node-server` |
| Validation | Zod 4 — at the edge only |
| Database | PostgreSQL 17 (`docker-compose.yml`), Drizzle ORM 0.45 + `pg`. `package.json` pins a safe `esbuild` inside `drizzle-kit`'s dependency tree via `overrides` — without it `npm audit` reports 4 moderate advisories |
| Tests | Vitest 5 — two configs, unit and integration |
| Lint | ESLint 10 + typescript-eslint |
| Runner | `tsx` |
| Auth | `jose` 6 — zero dependencies, Web Crypto, `createRemoteJWKSet` for Identity's key rotation. Not installed yet; phase 4 |
| Objects | MinIO over the S3 API, via `@aws-sdk/client-s3` — phase 6, not started |

`jose` and `@aws-sdk/client-s3` are not installed. They are the only additions to `package.json` the remaining phases require.

`exactOptionalPropertyTypes` is the flag that shapes the domain: an optional field is *omitted*, never passed as `undefined`. That is what makes domain.md §3's "an unset scalar is absent" true in the type system rather than only in prose.

This file is the only record of the stack and the layering rules — there is no `CLAUDE.md`.

## Layout and the one rule

```
src/
├─ domain/           entities, value objects, domain errors, repository interfaces
├─ application/      use cases, one file per use case
├─ infrastructure/   drizzle schema, repository implementation, db client, config
└─ interface/http/   hono routes, middleware, zod validators, mappers
tests/
├─ unit/             no database, no network
└─ integration/      real PostgreSQL, serial
```

**Dependencies point inward only.**

```
interface/http ──► application ──► domain ◄── infrastructure
```

`domain/` imports nothing but other domain files and Node built-ins — no Hono, no Drizzle, no Zod, no `pg`. `application/` depends on `domain/` and on the repository *interface* declared there, never on `infrastructure/`. Drizzle appears in `infrastructure/` and nowhere else. `interface/http/` holds no business rules.

The point: the domain stays testable with no database and no HTTP, and swapping Drizzle touches one directory.

`eslint.config.js` enforces this with per-directory `no-restricted-imports` zones, so a violation fails `npm run lint` with the layer's own rule as the message. `src/index.ts` is exempt — the composition root is the one place that knows every layer exists.

## Naming across layers

camelCase in TypeScript and JSON, snake_case in the database. Mapping happens in `infrastructure/`, nowhere else.

Units live in the type, not the name — `pace` is a `Pace`, and openapi.yaml's schema description says "seconds per kilometre". A bare number called `pace` outside a `Pace` is a bug.

Use domain.md §2's words everywhere: class names, fields, tests, commits.

## Phases

Built inside-out, so every phase is testable the moment it exists.

### 0 — Scaffold

Already done: `package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `vitest.int.config.ts`, `drizzle.config.ts`, `docker-compose.yml`, `.env.example`.

Scripts defined: `dev` · `typecheck` · `lint` · `test` · `test:int` · `db:generate` · `db:migrate` · `db:seed`. Three of them name files that do not exist yet — `src/index.ts`, `src/infrastructure/schema.ts`, `scripts/seed.ts`. They are the targets of phases 1–5.

`eslint.config.js` already carries the import zones, so the dependency rule is enforced from the first file written.

**Done when** `npm run typecheck`, `npm run lint` and `npm test` pass with zero source files.

### 1 — Domain

No database, no HTTP, no framework. Everything here comes from domain.md §3, §4 and §5.

- Value object classes — `Pace`, `Volume`, `PreferredDistance`, `PreferredRunTime`. Each validates in its constructor, is immutable after, and is compared by value
- Union types — `Gender`, `Area`, `Experience`. `as const` arrays plus `typeof X[number]`, so one declaration gives both a runtime list and the type
- `Profile` — the aggregate root. Validates the five plain fields itself — `userId`, `displayName`, `bio`, `avatarRef`, `birthYear` (§4) — holds the value objects, and is frozen. `userId` is its identity
- Domain errors — `ProfileNotFoundError`, `ProfileAlreadyExistsError`, and one for a field that breaks a §4 rule. Never an HTTP status in this layer
- `ProfileRepository` interface — `findById`, `insert`, `update`, `delete`. `insert` and `update` are separate so §5's invariant is enforced by the primary key, not by a check-then-write race

**Done when** every rule in §4 has a unit test that runs with no database, including the rejections.

### 2 — Infrastructure

- Drizzle schema at `src/infrastructure/schema.ts` — `drizzle.config.ts` already points there. `user_id text PRIMARY KEY`, one row per profile, no surrogate id
- Twelve columns, one per §3 field. `NOT NULL` on the three required fields **and on both sets** — an unset set is `[]`, never null, so the column has no third state. `text` for the unions, not Postgres `enum` — the `area` list is expected to change
- Collections stay in the row as `jsonb`. Nothing queries them — there is no list or search — so per-member indexes and child tables buy nothing, and one row keeps "loaded and saved as one unit" literal
- Sets are normalised on write — members sorted into declared enum order (`5k` before `10k`, `mon` before `tue`), never alphabetical. Storage is then deterministic and tests can assert literal arrays
- `npm run db:generate` for the migration, committed to `drizzle/`. It creates `drizzle/meta/` itself — an *empty* `meta/` makes it fail on a missing `_journal.json`, so never create that folder by hand
- `DrizzleProfileRepository implements ProfileRepository`
- A mapper both ways: snake_case ↔ camelCase, columns ↔ value objects. **Row → domain is a boundary** — every union and value object is re-validated on the way in, because §4's rules live in TypeScript and the table enforces none of them

**Done when** repository integration tests pass against real PostgreSQL — not a mock, not sqlite. Include the unique-violation path: driver errors may be wrapped, so find the SQLSTATE rather than assuming its depth.

### 3 — Application

One file per use case, named exactly for domain.md §3's operations:

```
createProfile   getProfile   updateProfile   deleteProfile
```

Each takes the repository interface, never a concrete class. `updateProfile` takes a set of changes: an absent field is left alone, an explicit null clears it. That is a partial-update semantic, not an HTTP one — the media type that expresses it is phase 4's business.

**Done when** each use case has a test using an in-memory repository, with no database. Helpers and test doubles live beside the suite that uses them — there is no shared `support/` folder.

### 4 — Interface / HTTP

Everything here comes from openapi.yaml.

- Hono routes for the four verbs on `/v1/profiles/:userId`, plus `GET /health` returning `{"status":"ok"}` without touching the database — `/health` is the one public endpoint
- One middleware verifies the bearer JWT from Identity **locally** with `jose` and produces a typed `caller` from its subject. No route, use case or domain object ever sees a header or a token. Ownership is then one comparison: caller vs the `userId` in the path

  ```ts
  const jwks = createRemoteJWKSet(new URL(config.identityJwksUrl))
  const { payload } = await jwtVerify(token, jwks, { issuer, audience: 'profile-service' })
  c.set('caller', { userId: payload.sub })
  ```

  `createRemoteJWKSet` fetches and caches Identity's public keys, so rotation needs no redeploy here. Verification is asymmetric on purpose: Identity signs, this service can only check — a shared secret would let either mint tokens for the other
- Zod validators matched to `ProfileWrite` and `ProfilePatch` — shape only; the rules live in the domain. A patch body is *not* the resource shape: seven fields accept `null` to clear, `displayName` and `birthYear` do not, and a set is replaced by sending a new array
- A view mapper: domain object → JSON. An unset scalar is absent, never null; an unset set is `[]`; `Pace` becomes a bare number
- Error middleware: domain error → RFC 9457 problem+json with `title`, `status`, optional `detail` — and the statuses openapi.yaml enumerates: **400** malformed body or unknown field, **401** no or invalid token, **403** not the owner, **404** no such profile, **409** already exists, **422** a value breaks a §4 rule, **500** otherwise

**Done when** integration tests cover every operation and every status openapi.yaml documents.

### 5 — Wiring and seed

- `src/index.ts` — composition root: config from environment, one pool, routes, listen
- Config read once at startup; a missing `DATABASE_URL` or `IDENTITY_JWKS_URL` fails there, not on the first request. `.env.example` carries all four: `DATABASE_URL`, `NODE_ENV`, `PORT`, `IDENTITY_JWKS_URL`
- Graceful shutdown: stop accepting, close idle connections, end the pool, and give up after a deadline rather than hanging
- `scripts/seed.ts` — reads `scripts/seed.json` and inserts through `createProfile`, so a row that breaks §4 fails at seed time rather than landing in the table. Refuses to run when `NODE_ENV=production`; it truncates first

**Done when** the service starts, serves all four operations end to end, answers `/health`, seeds, and stops cleanly.

### 6 — Avatar storage

domain.md §1 says the image lives in object storage owned by this service and only its key is stored here. Nothing resolves that key yet.

**MinIO** in `docker-compose.yml`, reached with `@aws-sdk/client-s3`. MinIO speaks the S3 API, so the same code runs against real S3 by changing an endpoint — the dependency is on a protocol, not a vendor. It is AGPL v3; pin a tag rather than tracking `latest`.

The domain does not change — `avatarRef` is already a string with a §4 rule, which is the evidence the boundary was drawn in the right place. The port goes in `application/`, not `domain/`: unlike `ProfileRepository`, the domain never resolves an avatar key, so storing images is not a domain concept.

Four decisions, none made: proxy or presigned upload; public bucket or presigned reads; key format; and who deletes the image when the profile is deleted — two systems that cannot commit together.

**Done when** an image can be uploaded, its key stored on the profile, and the image fetched back.

## Decisions taken

| | |
|---|---|
| **Authentication** | A JWT issued by Identity, verified **locally** on every request — not trusted because a gateway forwarded it. Its subject is the caller. Ownership is **access policy, not domain**: it lives in `openapi.yaml` as `bearerAuth` and the 401/403 responses, and domain.md stays silent on who may act |
| **Time-of-day buckets** | Bangkok local time (UTC+7) |
| **The `area` list** | Stays a closed union. It becomes reference data owned elsewhere only if the list outgrows a handful |
| **Readiness probe** | Not adding one. `/health` is liveness, which is what an orchestrator restarts on |
| **Boundary enforcement** | ESLint import zones, failing the build |

## Deferred on purpose

- **How Discovery gets profile data** — a copy built from events we publish, or queries to us. domain.md §1 says it is a decision for both services together, and it is what decides whether a bulk read ever exists
- **Identity deleting a runner** — §1 names the orphaned profile and leaves it unhandled. It is the first thing events would fix, so it waits on the decision above

## Definition of done

domain.md and openapi.yaml still describe what the code does.
