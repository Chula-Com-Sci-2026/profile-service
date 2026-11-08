import { randomUUID } from 'node:crypto'
import { describe, it } from 'vitest'
import { expectContract } from '../integration/contract.ts'
import { callService, signToken } from './client.ts'

/** The secret compose and .env.example give the service — and the one this service was not given. */
const DEVELOPMENT_SECRET = 'replace-with-local-access-signing-secret'

describe('Bad tokens are refused', () => {
  it('refuses no token, the development secret and the wrong audience, and lets a good token through', async () => {
    // Given a runner with no profile
    const id = randomUUID()

    // When they ask for their profile with no token, with a token signed with the development
    // secret, and with a token meant for another audience
    const none = await callService('/api/v1/me/profile')
    const wrongSecret = await callService('/api/v1/me/profile', {
      token: await signToken(id, { secret: DEVELOPMENT_SECRET }),
    })
    const wrongAudience = await callService('/api/v1/me/profile', {
      token: await signToken(id, { audience: 'some-other-service' }),
    })

    // Then each is a 401, with the documented error body
    await expectContract('getProfile', 401, none)
    await expectContract('getProfile', 401, wrongSecret)
    await expectContract('getProfile', 401, wrongAudience)

    // And a token signed with the secret the service was given gets past the check: the answer
    // is that this runner has no profile yet
    const good = await callService('/api/v1/me/profile', { token: await signToken(id) })
    await expectContract('getProfile', 404, good)
  })
})
