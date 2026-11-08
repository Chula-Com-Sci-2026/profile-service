# Profile Service

Runner profiles for Can't Run Alone. One runner, one profile: what they are like, and how, when
and where they usually run. It stores the profile, not the runner — the Identity Service owns
that, and a profile's `id` is the runner's Identity id, taken as given.

## Prerequisites

- **Node 24** — `node --version` should say `v24.x`
- **Docker**, running. Not optional: PostgreSQL, object storage and RabbitMQ run in it, the
  integration tests start their own containers, and the service ships as an image

## Quick start

```bash
docker compose up --build
```

`--build` makes the image from your checkout, not the last one built. The service listens on
**http://localhost:3000**.

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

Ray's profile is there once `cp .env.example .env && npm run db:seed` has run (see Local
development).

## API

| | | |
|---|---|---|
| `GET` | `/api/v1/me/profile` | your whole profile — 404 until you save one |
| `PUT` | `/api/v1/me/profile` | save it — creates or replaces, 200 every time |
| `PUT` | `/api/v1/me/profile/visibility` | choose which fields other runners see |
| `POST` | `/api/v1/me/profile/photo-uploads` | a link to upload a photo to |
| `PUT` | `/api/v1/me/profile/photo` | attach the uploaded photo |
| `DELETE` | `/api/v1/me/profile/photo` | remove the photo |
| `GET` | `/api/v1/runners/{id}` | a runner's public card, yours included |
| `GET` | `/api/v1/runners` | runners near you — temporary, until Buddy Discovery searches its own copy |
| `GET` | `/up` | is the process alive? |
| `GET` | `/ready` | should traffic come here? |
| `GET` | `/docs` | this API, rendered |
| `GET` | `/openapi.yaml` | the contract, as a file |

Everything under `/api/v1` needs a bearer token from Identity. “me” is the token's subject, so a
runner changes only their own profile; anyone's public card can be read. Nothing outside
`/api/v1` needs a token.

`GET /api/v1/runners` is temporary: Buddy Discovery searches through it until its own search, over
the copy it keeps of what this service publishes, is live — see [docs/domain.md](docs/domain.md)
§1. Distances run between area cells, never exact points.

Statuses and request and response shapes are in the contract: open `/docs`, or read
[docs/openapi.yaml](docs/openapi.yaml).

### A photo, in three steps

The image goes straight to object storage; this service hands out the link and records the key.

1. `POST /api/v1/me/profile/photo-uploads` answers `{uploadUrl, photoRef, expiresInSeconds}`.
2. `PUT` the image bytes to `uploadUrl` — no token, it is already signed — before it expires.
3. `PUT /api/v1/me/profile/photo` with `{"photoRef": "…"}` attaches it. The profile's `photoUrl`
   then loads in an `<img>`, with no token.

If object storage is down, steps 1 and 3 answer **503** `storage_unavailable`. Removing a photo
never answers 503, and nothing else touches storage, so saving and reading profiles carry on.

## Events

After every change — a save, a visibility change, a photo attached or removed — the service
writes `ProfileUpdated` to its outbox in the same transaction as the change, then sends it to
RabbitMQ: exchange `cra.events`, routing key `ProfileUpdated`, as its own broker user, `profile`.
The event carries the runner's public card and the profile's `revision`; its contract is
[docs/profile-events.schema.json](docs/profile-events.schema.json).

`EVENT_SENDER=rabbitmq` sends them, and compose and `.env.example` set it. Under `none`, the
default, every event still goes to the outbox and waits there. A save never waits on the broker:
with RabbitMQ down, saves carry on and the events go out, in order, once it is back.

Nothing here consumes the events, so until a queue is bound for `ProfileUpdated` they wait in the
outbox. To watch them by hand, bind a durable queue of your own and read from it (RabbitMQ 4
refuses one that is neither durable nor exclusive):

```bash
docker compose exec rabbitmq sh -c '
  a="rabbitmqadmin --username admin --password admin"
  $a declare exchange --name cra.events --type topic --durable true
  $a declare queue --name watch --durable true
  $a declare binding --source cra.events --destination-type queue --destination watch --routing-key ProfileUpdated'
docker compose exec rabbitmq rabbitmqadmin --username admin --password admin get messages --queue watch --count 10
```

The management UI is at **http://localhost:15672** (`admin` / `admin`).

**Sending every profile again.** `npm run events:republish` writes every profile's current
`ProfileUpdated` to the outbox, each under the revision it already has, and the running service
sends them. Run it on purpose, when a consumer's copy must be built or rebuilt. In a container it
is `docker compose exec profile-service node dist/republish-events.js`.

**Revisions restart at 1 after `npm run db:reset` or `npm run db:seed`** — the seed empties the
table and saves every runner afresh — and a consumer ignores a revision lower than the one it holds.
So reset Buddy Discovery's copy together with this database, or it keeps the old cards.

## Local development

The service runs from source; PostgreSQL, MinIO and RabbitMQ stay in Docker.

```bash
docker compose stop profile-service               # port 3000 has one owner — see below
cp .env.example .env                              # the defaults match docker compose
npm ci
docker compose up -d postgres minio create-bucket rabbitmq create-broker-user
npm run db:migrate
npm run db:seed                                   # seven runners, four with photos
npm run dev                                       # restarts on save, readable logs
```

Run that once; after it, `npm run dev` is the whole loop.

If a pull brings a migration that adds a required column, it cannot apply to rows already
there: `npm run db:migrate` fails, or under `docker compose up --build` the `migrate` container
exits and `profile-service` never starts. Throw the database away — it is disposable — with
`npm run db:reset`, then repeat the `docker compose up`, `db:migrate` and `db:seed` lines above.

**Port 3000 has one owner** — the container, or `npm run dev`. Stop one before starting the
other; that is what the first line does, and it is a no-op if nothing was running. Skip it and
you get `EADDRINUSE`.

The reverse is the one to know about, because Docker hides it. If `npm run dev` holds the port
when you `docker compose up`, the container cannot bind it and is left attached to no network — a
later `up` starts it without complaint, but `localhost:3000` answers nothing and it reports
`unhealthy`. Stop `npm run dev`, then recreate it:

```bash
docker compose up -d --force-recreate profile-service
```

## Commands

| | |
|---|---|
| `npm run dev` | run it locally, restarting on save |
| `npm test` | unit tests — no database, no Docker, about two seconds |
| `npm run test:int` | integration tests — starts its own PostgreSQL and RabbitMQ, so no setup |
| `npm run test:component` | component tests — builds the image and runs it beside its own PostgreSQL, MinIO and RabbitMQ; run by hand |
| `npm run typecheck` · `npm run lint` | both must pass |
| `npm run build` | compile to `dist/` |
| `npm start` | run what `build` produced — this is what the container runs |
| `npm run db:migrate` | apply migrations |
| `npm run db:seed` | reload the sample runners (**truncates first**) |
| `npm run events:republish` | write every profile's `ProfileUpdated` to the outbox again, revisions unchanged |
| `npm run db:reset` | throw away the stack's data — PostgreSQL, MinIO, RabbitMQ — and start PostgreSQL alone; then repeat the `docker compose up -d` line |
| `npm run db:generate` | after changing `src/infrastructure/schema.ts`, write the migration for it |

`npm run test:int` takes about twenty seconds, nearly all of it starting the containers — and it
passes on a machine that has never seen this project.

Each suite covers what the one before cannot. Unit tests run the code in memory, against fakes.
Integration tests run it against a real PostgreSQL and RabbitMQ, inside the test process.
Component tests run the built image as a black box — HTTP in, `ProfileUpdated` out, photos through
MinIO — importing nothing from `src/`, which `npm run lint` enforces, so they also cover the image
itself, the wiring in `src/index.ts` and shutdown. `npm run test:component` takes about twenty-five
seconds once Docker has the image's layers cached; the first run builds them.

`npm run build && npm start` runs exactly what the image runs. It needs `.env` and a migrated
PostgreSQL; MinIO for the photo routes, RabbitMQ for events to go out.

## Project structure

```
src/domain/          the model — Profile, its rules, no dependencies
src/application/     use cases, one per operation
src/infrastructure/  PostgreSQL, object storage, RabbitMQ, configuration
src/interface/http/  routes, middleware, request and response mapping
```

Dependencies point inward only: `interface → application → domain ← infrastructure`.

## Documentation

| | |
|---|---|
| [docs/domain.md](docs/domain.md) | **authoritative.** What a profile is and the rules it obeys — start here |
| [docs/openapi.yaml](docs/openapi.yaml) | the HTTP contract, derived from `domain.md`. Rendered at `/docs` |
| [docs/profile-events.schema.json](docs/profile-events.schema.json) | the event contract: `ProfileUpdated` on RabbitMQ, in the team's JSON Schema format |
| [compose.local-integration.yaml](compose.local-integration.yaml) | Profile for the team's local-integration stack: its own PostgreSQL and MinIO, its broker user, migrate, the service and an optional seed. Follow the steps at its top |
| [docs/build_plan.md](docs/build_plan.md) | why it is built this way, and what is deliberately left undone |

Tests hold the code to `openapi.yaml` and `profile-events.schema.json`. Nothing enforces
`domain.md` — and it still wins: where the code and `domain.md` disagree, the code is the bug.
