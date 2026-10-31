import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { Context } from 'hono'

/**
 * The contract, served by the service it describes.
 *
 * Two endpoints are part of the contract — `/docs` renders it, `/openapi.yaml` hands over the
 * file — and one is not: `/docs/{asset}` is a file server for Swagger UI's own JavaScript and
 * CSS. The assets ship inside the image rather than coming from a CDN, so the page renders with
 * no network and no third-party script runs on this origin. That costs 1.7 MB over the wire
 * and 11.4 MB in the image — swagger-ui-dist ships source maps and bundles we never serve.
 *
 * Nothing here reaches past the interface layer: a document and some static files, no use case.
 */

/**
 * An allow-list, not a lookup — `readFile(join(dir, c.req.param('asset')))` would serve
 * `../../../etc/passwd` just as happily. Only these two names resolve to anything, and only
 * these two are referenced by the page below.
 */
const ASSETS = new Map<string, { module: string; type: string }>([
  ['swagger-ui.css', { module: 'swagger-ui-dist/swagger-ui.css', type: 'text/css' }],
  ['swagger-ui-bundle.js', { module: 'swagger-ui-dist/swagger-ui-bundle.js', type: 'text/javascript' }],
])

/**
 * Resolved per request, not at import. `app.ts` imports this module statically, so resolving at
 * module scope makes an unresolvable `swagger-ui-dist` a boot failure of the whole service —
 * move it to devDependencies and `npm ci --omit=dev` produces a container that never answers
 * /up, while every test still passes because tests install dev dependencies. Lazily, the
 * blast radius is /docs.
 */
const require = createRequire(import.meta.url)

/**
 * `src/interface/http/` in development and `dist/interface/http/` in the image are the same
 * depth below the working directory, so one relative path finds `docs/openapi.yaml` in both.
 * The Dockerfile copies it in; without that this 500s, which `npm run test:int` would not catch.
 */
const CONTRACT = fileURLToPath(new URL('../../../docs/openapi.yaml', import.meta.url))

/**
 * Read once. These files cannot change while the process runs — they are inside the image.
 * All four are UTF-8 text (CSS, JavaScript, YAML), so they are cached as strings.
 */
const cache = new Map<string, string>()

async function load(path: string): Promise<string> {
  const hit = cache.get(path)
  if (hit !== undefined) return hit
  const text = await readFile(path, 'utf8')
  cache.set(path, text)
  return text
}

/**
 * Swagger UI's own page, minus the CDN. `url` points at our own copy of the document, so the
 * page and the service can never describe different versions.
 */
const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Profile Service API</title>
    <link rel="stylesheet" href="/docs/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/docs/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({ url: '/openapi.yaml', dom_id: '#swagger-ui' })
    </script>
  </body>
</html>
`

/** These bytes are inside the image; they cannot change while the process is alive. */
const IMMUTABLE = { 'cache-control': 'public, max-age=3600' }

export const documentationPage = (c: Context): Response => c.html(PAGE)

/**
 * Takes its path so a test can point it at a file that is not there — the deployment failure
 * this module's own comment says `npm run test:int` cannot otherwise reach.
 */
export const contractDocument =
  (path: string = CONTRACT) =>
  async (c: Context): Promise<Response> =>
    c.body(await load(path), 200, { 'content-type': 'application/yaml; charset=utf-8', ...IMMUTABLE })

export async function documentationAsset(c: Context): Promise<Response> {
  const asset = ASSETS.get(c.req.param('asset') ?? '')
  if (asset === undefined) return c.notFound()
  return c.body(await load(require.resolve(asset.module)), 200, {
    'content-type': asset.type,
    ...IMMUTABLE,
  })
}
