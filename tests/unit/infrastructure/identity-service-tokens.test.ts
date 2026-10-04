import { afterEach, describe, expect, it } from 'vitest'
import { identityServiceTokens, ServiceTokenError } from '../../../src/infrastructure/identity-service-tokens.ts'
import { localServer, type Reply } from './local-server.ts'

const SECRET = 's3cr3t-do-not-log'
let close: (() => Promise<void>) | undefined

afterEach(async () => {
  await close?.()
  close = undefined
})

async function identity(respond: (index: number) => Reply) {
  const server = await localServer((_, index) => respond(index))
  close = server.close
  return server
}

const options = (tokenUrl: string, now?: () => number) => ({
  tokenUrl,
  clientId: 'profile-service',
  clientSecret: SECRET,
  ...(now !== undefined && { now }),
})

describe('identityServiceTokens — asking Identity', () => {
  it('asks with client credentials, form-encoded (RFC 6749 §4.4)', async () => {
    const server = await identity(() => ({ status: 200, json: { access_token: 't1', expires_in: 300 } }))

    expect(await identityServiceTokens(options(server.url)).token()).toBe('t1')

    const [request] = server.received
    expect(request?.headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(Object.fromEntries(new URLSearchParams(request?.body))).toEqual({
      grant_type: 'client_credentials',
      client_id: 'profile-service',
      client_secret: SECRET,
    })
  })
})

describe('identityServiceTokens — keeping a token', () => {
  it('reuses it until 30 s before it expires, then asks again', async () => {
    let clock = 0
    const server = await identity((index) => ({ status: 200, json: { access_token: `t${index + 1}`, expires_in: 300 } }))
    const tokens = identityServiceTokens(options(server.url, () => clock))

    expect(await tokens.token()).toBe('t1')
    clock = 269_000
    expect(await tokens.token()).toBe('t1')
    clock = 270_000
    expect(await tokens.token()).toBe('t2')
    expect(server.received).toHaveLength(2)
  })

  it('never serves a token past its life when it lives under 30 s', async () => {
    const server = await identity((index) => ({ status: 200, json: { access_token: `t${index + 1}`, expires_in: 10 } }))
    const tokens = identityServiceTokens(options(server.url, () => 0))

    expect(await tokens.token()).toBe('t1')
    expect(await tokens.token()).toBe('t2')
  })

  it('asks again after invalidate — a subscriber said 401', async () => {
    const server = await identity((index) => ({ status: 200, json: { access_token: `t${index + 1}`, expires_in: 300 } }))
    const tokens = identityServiceTokens(options(server.url, () => 0))

    await tokens.token()
    tokens.invalidate()
    expect(await tokens.token()).toBe('t2')
  })
})

describe('identityServiceTokens — when Identity will not give one', () => {
  it('rejects on a refusal, and never repeats the secret', async () => {
    const server = await identity(() => ({ status: 401, json: { error: 'invalid_client' } }))

    const error = await identityServiceTokens(options(server.url)).token().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ServiceTokenError)
    expect(JSON.stringify({ message: (error as Error).message, stack: (error as Error).stack })).not.toContain(SECRET)
  })

  it('rejects an answer without access_token', async () => {
    const server = await identity(() => ({ status: 200, json: { token: 'wrong-shape' } }))

    await expect(identityServiceTokens(options(server.url)).token()).rejects.toThrow(ServiceTokenError)
  })
})

describe('identityServiceTokens — an answer without expires_in', () => {
  it('uses the token but keeps nothing — RFC 6749 only recommends expires_in, and a guess could go stale', async () => {
    const server = await identity((index) => ({ status: 200, json: { access_token: `t${index + 1}` } }))
    const tokens = identityServiceTokens(options(server.url, () => 0))

    expect(await tokens.token()).toBe('t1')
    expect(await tokens.token()).toBe('t2')
  })
})

describe('identityServiceTokens — concurrent askers', () => {
  it('share one request to Identity rather than each sending their own', async () => {
    const server = await identity(() => ({ status: 200, json: { access_token: 't1', expires_in: 300 } }))
    const tokens = identityServiceTokens(options(server.url, () => 0))

    expect(await Promise.all([tokens.token(), tokens.token(), tokens.token()])).toEqual(['t1', 't1', 't1'])
    expect(server.received).toHaveLength(1)
  })

  it('ask again after a shared request fails', async () => {
    const server = await identity((index) => (index === 0 ? { status: 503 } : { status: 200, json: { access_token: 't2', expires_in: 300 } }))
    const tokens = identityServiceTokens(options(server.url, () => 0))

    await expect(Promise.all([tokens.token(), tokens.token()])).rejects.toThrow(ServiceTokenError)
    expect(await tokens.token()).toBe('t2')
  })
})
