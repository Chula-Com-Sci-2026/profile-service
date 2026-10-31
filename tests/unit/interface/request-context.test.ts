import { describe, expect, it } from 'vitest'
import { correlationIdFrom } from '../../../src/interface/http/request-context.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('correlationIdFrom', () => {
  it('keeps a UUID it is given, lowercased', () => {
    expect(correlationIdFrom('ABCDEF01-2345-4678-89AB-CDEF01234567')).toBe('abcdef01-2345-4678-89ab-cdef01234567')
  })

  it.each([
    undefined,
    '',
    'abc123',
    '4bf92f3577b34da6a3ce929d0e0e4736',
    '{abcdef01-2345-4678-89ab-cdef01234567}',
    'abcdef01-2345-4678-89ab-cdef01234567x',
    'abcdef01-2345-4678-89ab-cdef0123456g',
  ])('replaces %j with a fresh UUID', (given) => {
    const id = correlationIdFrom(given)
    expect(id).toMatch(UUID)
    expect(id).not.toBe(given)
  })

  it('makes a different one each time', () => {
    expect(correlationIdFrom(undefined)).not.toBe(correlationIdFrom(undefined))
  })
})
