import { getContainerRuntimeClient, type StartedTestContainer } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { expectContract } from '../integration/contract.ts'
import { documentedBody } from './client.ts'
import { eventually } from './eventually.ts'
import { SHUTDOWN_DRAIN_MS, STOP_TIMEOUT_MS, startProfileService } from './stack.ts'

const { network, storageUrl } = inject('component')

/**
 * A service container of this file's own, on the shared stack: this scenario ends it, and every
 * other file keeps the shared one.
 */
let service: StartedTestContainer

beforeAll(async () => {
  service = await startProfileService(network, storageUrl)
})

afterAll(async () => {
  if (service === undefined) return
  // Kept after its stop so its exit code could be read — or stopped here, if the scenario failed
  // before it got that far — and removed now, volumes and all.
  await service.stop({ remove: false })
  const client = await getContainerRuntimeClient()
  await client.container.remove(client.container.getById(service.getId()), { removeVolumes: true })
})

describe('Graceful shutdown', () => {
  it('a stopped service drains, then exits 0 by itself', async () => {
    // Given the service is ready
    const url = `http://${service.getHost()}:${service.getMappedPort(3000)}`
    await expectContract('readiness', 200, await fetch(`${url}/ready`))

    // When the container is asked to stop (SIGTERM), and kept afterwards so its exit code can be read
    const asked = Date.now()
    const stopped = service.stop({ timeout: STOP_TIMEOUT_MS, remove: false })

    // Then /ready answers 503 during the drain, while the server still accepts connections
    const draining = await eventually(
      '/ready to answer 503 while the service drains',
      async () => {
        const answer = await fetch(`${url}/ready`, { signal: AbortSignal.timeout(1_000) }).catch(() => undefined)
        if (answer?.status === 503) return answer
        await answer?.body?.cancel()
        return undefined
      },
      { timeoutMs: SHUTDOWN_DRAIN_MS + 5_000, intervalMs: 100 },
    )
    expect(await documentedBody('readiness', 503, draining)).toEqual({ status: 'draining' })

    // And the process exits on its own with code 0 — not 137, a kill — before the stop timeout
    await stopped
    const client = await getContainerRuntimeClient()
    const { State } = await client.container.inspect(client.container.getById(service.getId()))
    expect(State.ExitCode, 'the exit code').toBe(0)
    expect(Date.now() - asked, 'how long the stop took, in ms').toBeLessThan(STOP_TIMEOUT_MS)
  })
})
