import { describe, expect, it } from 'vitest'
import { logOrphan } from '../../../src/infrastructure/log-orphan.ts'

function recordingLog() {
  const lines: { fields: Record<string, unknown>; message: string }[] = []
  return {
    lines,
    error: (fields: object, message: string) => {
      lines.push({ fields: fields as Record<string, unknown>, message })
    },
  }
}

describe('logOrphan', () => {
  it('puts the correlation id at the top level, where every other line of the request has it (NFR-7.4)', () => {
    const log = recordingLog()
    const failure = new Error('object storage is down')

    logOrphan(log, () => 'req-1', 'a photo object was orphaned')('11111111-1111-4111-8111-111111111111', failure)

    expect(log.lines).toEqual([
      {
        fields: { err: failure, id: '11111111-1111-4111-8111-111111111111', correlationId: 'req-1' },
        message: 'a photo object was orphaned',
      },
    ])
  })

  it('logs without a correlation id outside a request, rather than inventing one', () => {
    const log = recordingLog()

    logOrphan(log, () => undefined, 'a photo object was orphaned')('11111111-1111-4111-8111-111111111111', new Error('x'))

    expect(log.lines[0]?.fields['id']).toBe('11111111-1111-4111-8111-111111111111')
    expect(log.lines[0]?.fields['correlationId']).toBeUndefined()
  })
})
