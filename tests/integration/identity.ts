import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from 'jose'

/**
 * A stand-in for the Identity Service.
 *
 * It holds a real key pair and signs real tokens, so the middleware does genuine asymmetric
 * verification — `createLocalJWKSet` instead of `createRemoteJWKSet` is the only difference,
 * and it means the suite needs no network.
 */
export type Identity = {
  jwks: JWTVerifyGetKey
  issuer: string
  audience: string
  tokenFor: (userId: string) => Promise<string>
  tokenSignedByAnother: (userId: string) => Promise<string>
}

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey']

const ISSUER = 'https://identity.cantrunalone.test'
const AUDIENCE = 'profile-service'

async function keyPair() {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
  const jwk = await exportJWK(publicKey)
  return { privateKey, jwk: { ...jwk, kid: 'identity', alg: 'ES256' } }
}

export async function anIdentity(): Promise<Identity> {
  const real = await keyPair()
  const impostor = await keyPair()

  const sign = (key: PrivateKey, userId: string): Promise<string> =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'identity' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key)

  return {
    jwks: createLocalJWKSet({ keys: [real.jwk] }),
    issuer: ISSUER,
    audience: AUDIENCE,
    tokenFor: (userId) => sign(real.privateKey, userId),
    tokenSignedByAnother: (userId) => sign(impostor.privateKey, userId),
  }
}
