import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

type Compose = { services: Record<string, { image?: string; volumes?: string[] }> }

const compose = parse(readFileSync('docker-compose.yml', 'utf8')) as Compose
const minio = compose.services['minio']
const bucket = compose.services['create-bucket']
const component = readFileSync('tests/component/stack.ts', 'utf8').match(/MINIO_IMAGE = '([^']+)'/)?.[1]

describe('the MinIO image', () => {
  it('is Chainguard’s, pinned by digest, because MinIO stopped publishing images in October 2025', () => {
    expect(minio?.image).toMatch(/^cgr\.dev\/chainguard\/minio@sha256:[0-9a-f]{64}$/)
  })

  it('also runs the bucket job, since it carries mc and sh', () => {
    expect(bucket?.image).toBe(minio?.image)
  })

  it('keeps /data in an anonymous volume, as MinIO’s own image did, so a recreate keeps the photos and db:reset does not', () => {
    expect(minio?.volumes).toEqual(['/data'])
  })

  it('is the same for the component suite, which runs the image beside it', () => {
    expect(component).toBe(minio?.image)
  })
})
