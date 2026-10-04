/**
 * Short-lived tokens Identity issues to this service (ADR-0014: "calls without a user carry a
 * short-lived token issued to the calling service"), for the events it sends to Buddy Discovery.
 *
 * OAuth 2.0 client credentials (RFC 6749 §4.4). Identity's endpoint is a proposal to its owner:
 * no team document names one yet. Internal to infrastructure — only the event publisher asks.
 */
export type ServiceTokens = {
  /**
   * A caller with its own deadline passes its signal, so asking for a token spends the same
   * budget as the call the token is for, rather than a second one of its own.
   */
  token: (signal?: AbortSignal) => Promise<string>
  /** Forget the cached token — a subscriber answered 401. */
  invalidate: () => void
}

export type ServiceTokenOptions = {
  tokenUrl: string
  clientId: string
  clientSecret: string
  /** Default 1 000 ms, the same budget as one delivery attempt. */
  timeoutMs?: number
  /** Test seam: milliseconds since the epoch. */
  now?: () => number
}

/** Identity would not issue a token. Never carries the client secret. */
export class ServiceTokenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServiceTokenError'
  }
}

/** Ask again this long before Identity says the token expires, so it is never sent stale. */
const REFRESH_MARGIN_SECONDS = 30

export function identityServiceTokens(options: ServiceTokenOptions): ServiceTokens {
  const now = options.now ?? Date.now
  let cached: { value: string; refreshAt: number } | undefined
  // Concurrent writes on an empty cache share one request rather than each sending their own.
  let inFlight: Promise<string> | undefined

  async function ask(signal: AbortSignal | undefined): Promise<string> {
    const asked = now()
    const response = await fetch(options.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: options.clientId,
        client_secret: options.clientSecret,
      }),
      signal: signal ?? AbortSignal.timeout(options.timeoutMs ?? 1_000),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new ServiceTokenError(`Identity refused a service token: ${response.status}`)
    }

    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown }
    if (typeof body.access_token !== 'string') {
      throw new ServiceTokenError('Identity answered without access_token')
    }

    // RFC 6749 §5.1 only recommends expires_in. Without it the token is used once and not kept:
    // assuming a lifetime could serve one Identity has already expired.
    if (typeof body.expires_in === 'number') {
      const lifetime = Math.max(0, body.expires_in - REFRESH_MARGIN_SECONDS)
      cached = { value: body.access_token, refreshAt: asked + lifetime * 1_000 }
    }
    return body.access_token
  }

  return {
    token(signal) {
      if (cached !== undefined && now() < cached.refreshAt) return Promise.resolve(cached.value)
      inFlight ??= ask(signal).finally(() => {
        inFlight = undefined
      })
      return inFlight
    },

    invalidate() {
      cached = undefined
    },
  }
}
