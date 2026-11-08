import { randomUUID } from 'node:crypto'
import { SignJWT } from 'jose'
import { inject } from 'vitest'
import { expectContract } from '../integration/contract.ts'
import { TOKENS } from './stack.ts'

/**
 * The service as a client sees it: an address, HTTP and a bearer token. Nothing from `src/` — a
 * component test knows only what a caller of the running container could know.
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

/**
 * An access token as Identity signs one (ADR-0022): HS256 with the shared secret, the team's issuer
 * and audience, the runner's id as the subject, fifteen minutes to live. The suite holds the
 * secret it handed the service, so it can sign — and, with `changes`, sign wrongly on purpose.
 */
export function signToken(subject: string, changes: { secret?: string; audience?: string } = {}): Promise<string> {
  const { secret = TOKENS.secret, audience = TOKENS.audience } = changes
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
    .setIssuer(TOKENS.issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(secret))
}

/** A runner with a fresh id and a token for it: every scenario gets runners of its own. */
export type Runner = {
  readonly id: string
  get: (path: string) => Promise<Response>
  put: (path: string, body: unknown) => Promise<Response>
  post: (path: string) => Promise<Response>
  delete: (path: string) => Promise<Response>
}

export async function aRunner(): Promise<Runner> {
  const id = randomUUID()
  const token = await signToken(id)
  return {
    id,
    get: (path) => callService(path, { token }),
    put: (path, body) => callService(path, { method: 'PUT', token, body }),
    post: (path) => callService(path, { method: 'POST', token }),
    delete: (path) => callService(path, { method: 'DELETE', token }),
  }
}

/** What a save carries: the eight answers the team's profile form requires. */
export type ProfileSave = {
  name: string
  paceMin: number
  paceMax: number
  experience: 'Beginner' | 'Intermediate' | 'Advanced'
  area: string
  latitude: number
  longitude: number
  availability: string
}

/** A valid save — the seed's Ray, near Lumphini — with whatever a scenario needs changed. */
export function aProfile(changes: Partial<ProfileSave> = {}): ProfileSave {
  return {
    name: 'Ray Attajak',
    paceMin: 6,
    paceMax: 6.5,
    experience: 'Intermediate',
    area: 'Lumphini area',
    latitude: 13.7308,
    longitude: 100.5418,
    availability: 'Tue & Thu · 18:30',
    ...changes,
  }
}

/**
 * Checks a response against openapi.yaml — its status, headers and body schema — and hands back
 * the body, for the assertions that are part of a scenario's story.
 */
export async function documentedBody<T = Record<string, unknown>>(
  operationId: string,
  status: number,
  response: Response,
): Promise<T> {
  await expectContract(operationId, status, response.clone())
  return (await response.json()) as T
}
