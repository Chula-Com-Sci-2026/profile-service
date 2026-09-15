# Profile Service

Runner profiles for Can't Run Alone. One runner, one profile: what they are like, and how, when
and where they usually run.

It stores the profile. It does not store the runner — the Identity Service owns that, and we take
its `userId` as given.

## You need

- **Node 24** — `node --version` should say `v24.x`
- **Docker**, running. Not optional: PostgreSQL and object storage run in it, the integration
  tests start their own container, and the service ships as an image

## Run it

```bash
docker compose up
```

That starts everything and the service listens on **http://localhost:3000**.

```bash
curl http://localhost:3000/health   # {"status":"ok"}
curl http://localhost:3000/ready    # {"status":"ready"}
```

Profile endpoints answer **401** — they need a token from the Identity Service, and no Identity
runs in this stack. `/health` and `/ready` are the two that work without one.

So you cannot call the profile API from here yet. That is not a bug: this service verifies
Identity's signature on every request and cannot mint a token for you, which is the point — it
can check, and only Identity can sign. To exercise the API you need Identity running and
`IDENTITY_JWKS_URL` pointing at it. Until then, `npm run test:int` is where the profile
endpoints actually get driven, tokens and all.

## What it does

| | | |
|---|---|---|
| `PUT` | `/v1/profiles/{userId}` | create a profile — 409 if the runner already has one |
| `GET` | `/v1/profiles/{userId}` | read one |
| `PATCH` | `/v1/profiles/{userId}` | change one — `null` clears a field |
| `DELETE` | `/v1/profiles/{userId}` | delete one, permanently |
| `POST` | `/v1/profiles/{userId}/avatar-uploads` | create an upload — returns a URL to PUT the image to |
| `GET` | `/health` | is the process alive? |
| `GET` | `/ready` | should traffic come here? |

Everything under `/v1` needs a bearer token from Identity, and you may only *change* your own
profile — reading anyone's is allowed. `/health` and `/ready` need no token.

There is no way to list or search profiles. That is deliberate, and
[docs/domain.md](docs/domain.md) §1 explains what it is waiting on.

For statuses, request and response shapes, and the avatar handshake, read
[docs/openapi.yaml](docs/openapi.yaml) — it is the contract, and the tests check the code
against it on every run.

## Work on it

```bash
docker compose stop profile-service               # it holds port 3000; you want it
cp .env.example .env                              # the defaults match docker compose
npm ci
docker compose up -d postgres minio create-bucket
npm run db:migrate
npm run db:seed                                   # five runners, four with avatars
npm run dev                                       # restarts on save, readable logs
```

Skip the first line if you never ran `docker compose up`. If you forget it, the service says
`the server could not start` with `EADDRINUSE` — that is the container, not you.

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

`npm run test:int` needs nothing set up. It starts a PostgreSQL container, migrates it, runs, and
throws it away — so it passes on a machine that has never seen this project. Give it about ten
seconds; most of that is the container.

Building and running it yourself, without Docker doing it for you:

```bash
npm run build && npm start
```

Same code the image runs — the container is `node dist/index.js` too. It needs the same
environment, so `.env` must be in place and PostgreSQL and MinIO must be up.

## Two things that will confuse you otherwise

**Imports end in `.ts`, not `.js`.**

```ts
import { Profile } from './profile.ts'
```

That is deliberate and it compiles. TypeScript rewrites the extension on the way out. If you are
about to "fix" this, read the **Imports** section of [docs/build_plan.md](docs/build_plan.md) first.

**`domain/` may not import anything.** No Hono, no Drizzle, no Zod, no logger — `npm run lint`
fails if it does. Each layer has a rule like that, and the error message tells you which one you
broke.

## What is where

```
src/domain/          the model — Profile, its rules, no dependencies
src/application/     use cases, one per operation
src/infrastructure/  PostgreSQL, object storage, configuration
src/interface/http/  routes, middleware, request and response mapping
```

Dependencies point inward only: `interface → application → domain ← infrastructure`.

## The documents

Read them in this order. They are short.

| | |
|---|---|
| [docs/domain.md](docs/domain.md) | **the spec, and it wins.** What a profile is and the rules it obeys |
| [docs/openapi.yaml](docs/openapi.yaml) | the HTTP contract, derived from the spec. The tests check the code against it |
| [docs/build_plan.md](docs/build_plan.md) | why things are the way they are, and what is deliberately not done yet |

If the code and `domain.md` disagree, `domain.md` is right and the code is a bug.
