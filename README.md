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

## Work on it

```bash
cp .env.example .env                              # the defaults match docker compose
npm ci
docker compose up -d postgres minio create-bucket
npm run db:migrate
npm run db:seed                                   # five runners, four with avatars
npm run dev                                       # restarts on save, readable logs
```

## Commands

| | |
|---|---|
| `npm run dev` | run it locally, restarting on save |
| `npm test` | unit tests — no database, no Docker, about a second |
| `npm run test:int` | integration tests — starts its own PostgreSQL, so no setup |
| `npm run typecheck` · `npm run lint` | both must pass |
| `npm run build` | compile to `dist/` |
| `npm run db:migrate` | apply migrations |
| `npm run db:seed` | reload the sample runners (**truncates first**) |
| `npm run db:reset` | throw the database away and start it again |

`npm run test:int` needs nothing set up. It starts a PostgreSQL container, migrates it, runs, and
throws it away — so it passes on a machine that has never seen this project.

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
