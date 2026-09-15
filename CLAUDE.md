# CLAUDE.md

Runner-profile microservice. Node 24 · TypeScript · Hono · Drizzle/PostgreSQL · S3 storage.
A demonstration of microservices + DDD, so architectural clarity outranks cleverness.

## Read first

| | |
|---|---|
| `docs/domain.md` | **authoritative.** What a profile is and the rules it obeys. If code disagrees, the code is the bug |
| `docs/openapi.yaml` | the HTTP contract, derived from the spec. Tests check the code against it |
| `docs/build_plan.md` | **Decisions taken** (13) and **Deferred on purpose** (8). Settled — do not re-litigate or report as findings |
| `README.md` | how a human runs it |

## Commands

```bash
npm run dev        # node --watch, pretty logs
npm test           # unit, ~1s, no Docker
npm run test:int   # integration — starts its own PostgreSQL via Testcontainers
npm run typecheck && npm run lint    # both must pass
npm run build      # tsc -> dist/
```

## Five things that will trip you up

**Imports end in `.ts`, not `.js`** — `import { Profile } from './profile.ts'`. Deliberate;
TypeScript rewrites the extension on emit. Do not "fix" it.

**Optional profile fields are `declare readonly bio?: string`.** The `declare` is load-bearing: a
plain field would define the key as `undefined`, and `domain.md` §3 says an unset scalar is
*absent*. Removing it breaks `'bio' in profile`.

**Layers are enforced by `npm run lint`, not convention.** `interface/http → application → domain
← infrastructure`. `domain/` imports nothing — no Hono, Drizzle, Zod, pino. `src/index.ts` is the
composition root and the only file allowed to reach across zones. The lint error names the rule.

**Contract first.** To change behaviour, edit `docs/openapi.yaml` first; the coverage assertion in
`tests/integration/http.test.ts` then fails naming the response nothing exercises. Implement until
green. Never generate the spec from the code.

**TypeScript is pinned `~6.0.3`** because `typescript-eslint` declares `peerDependencies.typescript:
">=4.8.4 <6.1.0"`. Bumping it breaks lint.

## Documents are tested

Four tests fail when a document drifts from the code: `tests/integration/contract.ts` (responses),
`tests/unit/interface/routes-match-contract.test.ts` (paths), `readme-endpoints.test.ts` (README
table), `tests/unit/infrastructure/env-example.test.ts` (`.env.example` ↔ `config.ts`).
When one fails, the document is usually what needs fixing — not the test.

## Conventions

- Validate **shape** at the edge (Zod), enforce **rules** in the domain. Each rule has one home.
- `Profile` is immutable; `update()` returns a new one.
- Repository reads report absence (`null`), writes raise conflicts.
- Commits: Conventional Commits, scope is the layer — `fix(domain):`, `docs(plan):`.
- The local database is disposable; `npm run db:reset` then `npm run db:seed`.
- Port 3000 has one owner: the compose container *or* `npm run dev`, never both.
