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
  it('puts the request id at the top level, where every other line of the request has it (NFR-7.4)', () => {
    const log = recordingLog()
    const failure = new Error('object storage is down')

    logOrphan(log, () => 'req-1', 'an avatar object was orphaned by a profile change')('7f3a9c2e15', failure)

    expect(log.lines).toEqual([
      {
        fields: { err: failure, userId: '7f3a9c2e15', requestId: 'req-1' },
        message: 'an avatar object was orphaned by a profile change',
      },
    ])
  })

  it('logs without a request id outside a request, rather than inventing one', () => {
    const log = recordingLog()

    logOrphan(log, () => undefined, 'avatar objects orphaned after deleting a profile')('7f3a9c2e15', new Error('x'))

    expect(log.lines[0]?.fields['userId']).toBe('7f3a9c2e15')
    expect(log.lines[0]?.fields['requestId']).toBeUndefined()
  })
})
