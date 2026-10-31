# Profile Service

Runner profiles for Can't Run Alone. One runner, one profile: what they are like, and how, when
and where they usually run. It stores the profile, not the runner — the Identity Service owns
that, and a profile's `id` is the runner's Identity id, taken as given.

## Prerequisites

- **Node 24** — `node --version` should say `v24.x`
- **Docker**, running. Not optional: PostgreSQL and object storage run in it, the integration
  tests start their own container, and the service ships as an image

## Quick start

```bash
docker compose up
```

The service listens on **http://localhost:3000**.

**Open http://localhost:3000/docs** — the whole API, rendered. The service serves that page
itself, so it always matches the version running.

```bash
curl localhost:3000/up       # {"status":"ok"}
curl localhost:3000/ready    # {"status":"ready"}
```

`/api/v1` answers **401** without a bearer token. Tokens are Identity's access tokens: HS256, signed
with a secret every service shares (`ACCESS_TOKEN_SECRET`, ADR-0022), issuer
`cant-run-alone-local`, audience `cant-run-alone-services`, and the runner's id as the subject.
Holding the secret is enough to sign one. After `npm ci`, from this directory, this makes one for
Ray with the development secret compose uses:

```bash
TOKEN=$(node --input-type=module -e "
import { SignJWT } from 'jose'
console.log(await new SignJWT({}).setProtectedHeader({ alg: 'HS256' })
  .setSubject('11111111-1111-4111-8111-111111111111')
  .setIssuer('cant-run-alone-local').setAudience('cant-run-alone-services')
  .setExpirationTime('15m').sign(new TextEncoder().encode('replace-with-local-access-signing-secret')))")
curl -H "Authorization: Bearer $TOKEN" localhost:3000/api/v1/me/profile
```

Ray's profile is there once `npm run db:seed` has run (see Local development).

## API

| | | |
|---|---|---|
| `GET` | `/api/v1/me/profile` | your whole profile — 404 until you save one |
| `PUT` | `/api/v1/me/profile` | save it — creates or replaces, 200 every time |
| `GET` | `/api/v1/runners/{id}` | a runner's public card, yours included |
| `GET` | `/up` | is the process alive? |
| `GET` | `/ready` | should traffic come here? |
| `GET` | `/docs` | this API, rendered |
| `GET` | `/openapi.yaml` | the contract, as a file |

Everything under `/api/v1` needs a bearer token from Identity. “me” is the token's subject, so a
runner changes only their own profile; anyone's public card can be read. Nothing outside
`/api/v1` needs a token.

Profiles cannot be listed or searched — deliberately: Buddy Discovery keeps its own copy of what
this service publishes, as [docs/domain.md](docs/domain.md) §1 explains.

Statuses, request and response shapes, and the avatar handshake are in the contract: open
`/docs`, or read [docs/openapi.yaml](docs/openapi.yaml).

## Local development

The service runs from source; PostgreSQL and MinIO stay in Docker.

```bash
docker compose stop profile-service               # port 3000 has one owner — see below
cp .env.example .env                              # the defaults match docker compose
npm ci
docker compose up -d postgres minio create-bucket
npm run db:migrate
npm run db:seed                                   # seven runners, four with avatars
npm run dev                                       # restarts on save, readable logs
```

Run that once; after it, `npm run dev` is the whole loop.

If a pull brings a migration that adds a required column, it cannot apply to rows already
there: `npm run db:migrate` fails, or under `docker compose up` the `migrate` container exits and
`profile-service` never starts. Throw the database away — it is disposable — with
`npm run db:reset`, then repeat the `docker compose up`, `db:migrate` and `db:seed` lines above.

The same goes once after the move to PostgreSQL 16: a database the old 17 image created will not
start under 16, and `db:reset` is what replaces it.

**Port 3000 has one owner** — the container, or `npm run dev`. Stop one before starting the
other; that is what the first line does, and it is a no-op if nothing was running. Skip it and
you get `EADDRINUSE`.

The reverse is the one to know about, because Docker hides it. If `npm run dev` holds the port
when you `docker compose up`, the container cannot bind it and is left attached to no network —
it then starts again without complaint while `localhost:3000` answers nothing and it reports
`unhealthy`. Rebuild it:

```bash
docker compose up -d --force-recreate profile-service
```

## Commands

| | |
|---|---|
| `npm run dev` | run it locally, restarting on save |
| `npm test` | unit tests — no database, no Docker, about a second |
| `npm run test:int` | integration tests — starts its own PostgreSQL, so no setup |
| `npm run typecheck` · `npm run lint` | both must pass |
| `npm run build` | compile to `dist/` |
| `npm start` | run what `build` produced — this is what the container runs |
| `npm run db:migrate` | apply migrations |
| `npm run db:seed` | reload the sample runners (**truncates first**) |
| `npm run db:reset` | throw the database away and start it again |
| `npm run db:generate` | after changing `src/infrastructure/schema.ts`, write the migration for it |

`npm run test:int` takes about ten seconds, nearly all of it starting the container — and it
passes on a machine that has never seen this project.

`npm run build && npm start` runs exactly what the image runs. It needs `.env` in place, and
PostgreSQL and MinIO up.

## Project structure

```
src/domain/          the model — Profile, its rules, no dependencies
src/application/     use cases, one per operation
src/infrastructure/  PostgreSQL, object storage, configuration
src/interface/http/  routes, middleware, request and response mapping
```

Dependencies point inward only: `interface → application → domain ← infrastructure`.

## Documentation

| | |
|---|---|
| [docs/domain.md](docs/domain.md) | **authoritative.** What a profile is and the rules it obeys — start here |
| [docs/openapi.yaml](docs/openapi.yaml) | the HTTP contract, derived from `domain.md`. Rendered at `/docs` |
| [docs/build_plan.md](docs/build_plan.md) | why it is built this way, and what is deliberately left undone |

Tests hold the code to `openapi.yaml` on every run. Nothing enforces `domain.md` — and it still
wins: where the code and `domain.md` disagree, the code is the bug.
