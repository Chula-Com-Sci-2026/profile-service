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
 * no network and no third-party script runs on this origin. That costs about 1.7 MB.
 *
 * Nothing here reaches past the interface layer: a document and some static files, no use case.
 */

/** Resolved from `node_modules`, so the version is whatever package-lock.json pinned. */
const require = createRequire(import.meta.url)

/**
 * An allow-list, not a lookup — `readFile(join(dir, c.req.param('asset')))` would serve
 * `../../../etc/passwd` just as happily. Only these three names resolve to anything.
 */
const ASSETS = new Map<string, { path: string; type: string }>([
  ['swagger-ui.css', { path: require.resolve('swagger-ui-dist/swagger-ui.css'), type: 'text/css' }],
  [
    'swagger-ui-bundle.js',
    { path: require.resolve('swagger-ui-dist/swagger-ui-bundle.js'), type: 'text/javascript' },
  ],
  [
    'swagger-ui-standalone-preset.js',
    {
      path: require.resolve('swagger-ui-dist/swagger-ui-standalone-preset.js'),
      type: 'text/javascript',
    },
  ],
])

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

export const documentationPage = (c: Context): Response =>
  c.html(PAGE)

export async function contractDocument(c: Context): Promise<Response> {
  return c.body(await load(CONTRACT), 200, { 'content-type': 'application/yaml; charset=utf-8' })
}

export async function documentationAsset(c: Context): Promise<Response> {
  const asset = ASSETS.get(c.req.param('asset') ?? '')
  if (asset === undefined) return c.notFound()
  return c.body(await load(asset.path), 200, { 'content-type': asset.type })
}
