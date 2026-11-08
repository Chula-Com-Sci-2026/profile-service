import { inject } from 'vitest'

/**
 * The service as a client sees it: an address and HTTP. Nothing from `src/` — a component test
 * knows only what a caller of the running container could know.
 */
const { serviceUrl } = inject('component')

export type RequestOptions = { method?: string; token?: string; body?: unknown }

/** One request to the running service. JSON in when there is a body; a bearer token when given one. */
export function callService(path: string, { method = 'GET', token, body }: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {}
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  return fetch(`${serviceUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
