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
  ports?: string[]
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

  it('publishes MinIO’s API on 127.0.0.1 only, and points OBJECT_STORAGE_PUBLIC_ENDPOINT there', () => {
    const ports = service('profile-minio').ports ?? []
    expect(ports.length).toBeGreaterThan(0)
    for (const port of ports) expect(port).toMatch(/^127\.0\.0\.1:/)
    expect(service('profile-service').environment?.['OBJECT_STORAGE_PUBLIC_ENDPOINT']).toBe('http://127.0.0.1:9000')
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

  it('publishes no port of its PostgreSQL or of the service — local-integration keeps service ports internal', () => {
    expect(service('profile-postgres').ports).toBeUndefined()
    expect(service('profile-service').ports).toBeUndefined()
  })
})
