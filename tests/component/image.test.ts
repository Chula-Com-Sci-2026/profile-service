import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { expectContract } from '../integration/contract.ts'
import { callService } from './client.ts'

describe('The image serves its contract', () => {
  it('answers its probes, its own openapi.yaml byte for byte, and its documentation page', async () => {
    // Given the built image is running beside its own PostgreSQL, RabbitMQ and MinIO

    // When a client with no token asks for the probes, the contract and the docs
    const up = await callService('/up')
    const ready = await callService('/ready')
    const contract = await callService('/openapi.yaml')
    const docs = await callService('/docs')

    // Then each answers as openapi.yaml documents
    await expectContract('liveness', 200, up)
    await expectContract('readiness', 200, ready)
    // And the contract it serves is the repo's file, byte for byte: the image carries it
    const served = Buffer.from(await contract.clone().arrayBuffer())
    expect(served.equals(readFileSync('docs/openapi.yaml')), 'GET /openapi.yaml is docs/openapi.yaml, byte for byte').toBe(true)
    await expectContract('contract', 200, contract)
    await expectContract('documentation', 200, docs)
  })
})
