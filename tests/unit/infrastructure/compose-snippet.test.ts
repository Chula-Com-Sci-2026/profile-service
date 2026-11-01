import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/**
 * `compose.local-integration.yaml` is a document for a teammate to copy into the team's
 * local-integration stack, so it is held to what the spec promises of it and to the images
 * `docker-compose.yml` already runs. Nothing else would notice it drifting.
 */
type Service = {
  image?: string
  build?: unknown
  profiles?: string[]
  command?: string[]
  ports?: string[]
  volumes?: string[]
  depends_on?: Record<string, unknown>
  environment?: Record<string, string>
  entrypoint?: string[]
}
type Compose = { services: Record<string, Service> } & Record<string, unknown>

const snippetText = readFileSync('compose.local-integration.yaml', 'utf8')
const snippet = parse(snippetText) as Compose
const ours = parse(readFileSync('docker-compose.yml', 'utf8')) as Compose

const service = (name: string): Service => {
  const found = snippet.services[name]
  if (found === undefined) throw new Error(`the snippet has no ${name}`)
  return found
}

describe('compose.local-integration.yaml', () => {
  it('runs the same images as docker-compose.yml — PostgreSQL, MinIO, mc and RabbitMQ', () => {
    const theirs = new Set(Object.values(ours.services).map((s) => s.image))
    const pulled = Object.values(snippet.services)
      .filter((s) => s.build === undefined)
      .map((s) => s.image)
    expect(pulled.length).toBeGreaterThanOrEqual(4)
    expect(pulled.filter((image) => !theirs.has(image))).toEqual([])
  })

  it('starts Profile once its own PostgreSQL is healthy and migrate has finished, and on nothing else', () => {
    expect(service('profile-service').depends_on).toEqual({
      'profile-postgres': { condition: 'service_healthy' },
      'profile-migrate': { condition: 'service_completed_successfully' },
    })
  })

  it('publishes MinIO’s API on 127.0.0.1 only, on one port — PROFILE_PHOTO_PORT, 9000 unless set — that OBJECT_STORAGE_PUBLIC_ENDPOINT names too', () => {
    const photoPort = '${PROFILE_PHOTO_PORT:-9000}'
    expect(service('profile-minio').ports).toEqual([`127.0.0.1:${photoPort}:9000`])
    expect(service('profile-service').environment?.['OBJECT_STORAGE_PUBLIC_ENDPOINT']).toBe(`http://127.0.0.1:${photoPort}`)
    expect(snippetText.indexOf('PROFILE_PHOTO_PORT')).toBeLessThan(snippetText.indexOf('services:'))
  })

  it('gives the broker user configure and write on ^cra\\.events$ and read on nothing', () => {
    const script = (service('profile-create-broker-user').entrypoint ?? []).join('\n')
    expect(script).toContain("--configure '^cra\\.events$$' --write '^cra\\.events$$' --read '^$$'")
    expect(script).toContain('declare user --name profile')
  })

  it('sends events as the profile user, to the broker named at the top', () => {
    const top = snippet['x-profile'] as Record<string, string>
    expect(service('profile-service').environment).toMatchObject({
      EVENT_SENDER: 'rabbitmq',
      RABBITMQ_USER: 'profile',
      RABBITMQ_HOST: top['broker-host'],
    })
  })

  it('names what it cannot know at the top: the name and port Profile is dialled on, the broker, its admin login, the token secret and the checkout', () => {
    expect(Object.keys(snippet['x-profile'] as object).sort()).toEqual(
      ['access-token-secret', 'broker-admin-password', 'broker-admin-user', 'broker-host', 'checkout', 'port', 'service-name'].sort(),
    )
    expect(snippetText.indexOf('x-profile:')).toBeLessThan(snippetText.indexOf('services:'))
  })

  it('seeds only when asked: profile-seed sits under a profile, so a plain `up` never empties the table', () => {
    const seed = service('profile-seed')
    expect(seed.profiles).toEqual(['seed'])
    expect(seed.command).toEqual(['node', 'scripts/seed.ts'])
    expect(seed.environment?.['DATABASE_URL']).toBe(service('profile-service').environment?.['DATABASE_URL'])
  })

  it('builds the seed from the build stage, the only stage that copies scripts/', () => {
    expect(service('profile-seed').build).toMatchObject({ target: 'build' })
    const dockerfile = readFileSync('Dockerfile', 'utf8')
    const copied = dockerfile.indexOf('COPY scripts ./scripts')
    expect(copied).toBeGreaterThan(dockerfile.indexOf('AS build'))
    expect(copied).toBeLessThan(dockerfile.indexOf('AS runtime'))
    expect(readFileSync('.dockerignore', 'utf8').split('\n')).not.toContain('scripts')
  })

  it('keeps Profile’s data across `down`, in named volumes, as the team’s other services do', () => {
    expect(service('profile-postgres').volumes).toEqual(['profile-postgres-data:/var/lib/postgresql/data'])
    expect(service('profile-minio').volumes).toEqual(['profile-minio-data:/data'])
    expect(Object.keys(snippet['volumes'] as object).sort()).toEqual(['profile-minio-data', 'profile-postgres-data'])
  })

  it('publishes no port of its PostgreSQL or of the service — local-integration keeps service ports internal', () => {
    expect(service('profile-postgres').ports).toBeUndefined()
    expect(service('profile-service').ports).toBeUndefined()
  })
})
