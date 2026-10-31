import { readFileSync } from 'node:fs'
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js'
import { parse } from 'yaml'
import { expect } from 'vitest'

/**
 * `openapi.yaml` as a test oracle: the code must obey the document.
 *
 * OpenAPI 3.1 *is* JSON Schema 2020-12, so Ajv's 2020 build reads the schemas as they stand —
 * `unevaluatedProperties`, the `allOf` with sibling `required`, and the `$ref`s into
 * `ProfileFields/properties/…` all resolve. Strict mode is off because the document carries
 * OpenAPI keywords Ajv has no opinion about.
 */
const DOCUMENT_ID = 'openapi.yaml'
type Node = Record<string, unknown>
const document = parse(readFileSync('docs/openapi.yaml', 'utf8')) as Node

const ajv = new Ajv2020({ strict: false, allErrors: true })
ajv.addSchema(document, DOCUMENT_ID)

const escape = (segment: string): string => segment.replace(/~/g, '~0').replace(/\//g, '~1')

function at(pointer: string): Node | undefined {
  return pointer
    .split('/')
    .slice(1)
    .reduce<Node | undefined>(
      (node, raw) => node?.[raw.replace(/~1/g, '/').replace(/~0/g, '~')] as Node | undefined,
      document,
    )
}

/** operationId → the pointer of its responses object. */
const operations = new Map<string, string>()
/** Every response the document declares, as "operationId status" — including `default`. */
const documented = new Set<string>()

for (const [path, item] of Object.entries(document['paths'] as Node)) {
  for (const [method, operation] of Object.entries(item as Node)) {
    const id = (operation as Node)['operationId']
    if (typeof id !== 'string') continue
    operations.set(id, `/paths/${escape(path)}/${method}/responses`)
    for (const status of Object.keys((operation as Node)['responses'] as Node)) {
      documented.add(`${id} ${status}`)
    }
  }
}

export const documentedResponses: readonly string[] = [...documented]

/** Every response this run has checked. The coverage assertion compares the two. */
export const exercised = new Set<string>()

function responsePointer(operationId: string, status: number): string {
  const responses = operations.get(operationId)
  if (responses === undefined) throw new Error(`openapi.yaml documents no operation "${operationId}"`)

  // A status the document does not enumerate falls to `default`, which is where 500 lives.
  const enumerated = `${responses}/${status}`
  const pointer = at(enumerated) === undefined ? `${responses}/default` : enumerated
  const node = at(pointer)
  if (node === undefined) {
    throw new Error(`openapi.yaml documents neither ${status} nor a default for "${operationId}"`)
  }
  exercised.add(`${operationId} ${pointer.split('/').pop() ?? status}`)
  // `$ref: '#/components/responses/Unauthorized'` — follow it rather than dereferencing by hand.
  const ref = node['$ref']
  return typeof ref === 'string' ? ref.slice(1) : pointer
}

/** The only media types allowed to carry no schema. Anything else missing one is a broken document. */
const UNCONSTRAINED = new Set(['text/html', 'application/yaml'])

const compiled = new Map<string, ValidateFunction>()
function validator(pointer: string): ValidateFunction {
  const existing = compiled.get(pointer)
  if (existing !== undefined) return existing
  const fresh = ajv.compile({ $ref: `${DOCUMENT_ID}#${pointer}` })
  compiled.set(pointer, fresh)
  return fresh
}

/** The header every response carries: the request's correlation id (NFR-7.4). */
const CORRELATION_HEADER = 'X-Correlation-Id'

/**
 * Every response must document the correlation header, and every header a response documents is
 * checked: present when `required`, and matching its schema when sent. The coverage assertion
 * makes every documented response run through here, so "echoed on every response" is held for
 * all of them, not promised.
 */
function expectHeaders(operationId: string, status: number, pointer: string, response: Response): void {
  const headers = (at(pointer)?.['headers'] ?? {}) as Node
  expect(Object.keys(headers), `${operationId} ${status} documents ${CORRELATION_HEADER}`).toContain(
    CORRELATION_HEADER,
  )

  for (const [name, declared] of Object.entries(headers)) {
    const ref = (declared as Node)['$ref']
    const headerPointer = typeof ref === 'string' ? ref.slice(1) : `${pointer}/headers/${escape(name)}`
    const value = response.headers.get(name)
    if (at(headerPointer)?.['required'] === true) {
      expect(value, `${operationId} ${status} sends ${name}`).not.toBeNull()
    }
    if (value === null) continue

    const validate = validator(`${headerPointer}/schema`)
    if (!validate(value)) {
      throw new Error(
        `${operationId} ${status} sent ${name}: ${JSON.stringify(value)}, which broke the contract: ` +
          ajv.errorsText(validate.errors),
      )
    }
  }
}

/**
 * Asserts the response is the status openapi.yaml documents, carries the headers and a media type
 * it documents, and has a body its schema accepts.
 */
export async function expectContract(
  operationId: string,
  status: number,
  response: Response,
): Promise<void> {
  expect(response.status, `status for ${operationId}`).toBe(status)

  const pointer = responsePointer(operationId, status)
  expectHeaders(operationId, status, pointer, response)
  const content = at(pointer)?.['content'] as Node | undefined

  if (content === undefined) {
    expect(await response.text(), `${operationId} ${status} documents no body`).toBe('')
    return
  }

  const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
  expect(Object.keys(content), `media type for ${operationId} ${status}`).toContain(mediaType)

  // A rendered page and a YAML file have no useful schema, so the contract documents the media
  // type and nothing else. Ajv has nothing to compile and `response.json()` would throw, so
  // assert the only promise made: there is a body.
  //
  // Keyed on the media type, never on "no schema found". Keyed the other way, a typo in the
  // document — `schena:` — makes every response schemaless and downgrades ~40 assertions to
  // "not the empty string". Measured: the whole suite passed with an error schema misspelt.
  if ((content[mediaType] as Node | undefined)?.['schema'] === undefined) {
    expect(
      UNCONSTRAINED.has(mediaType),
      `openapi.yaml documents ${mediaType} for ${operationId} ${status} with no schema`,
    ).toBe(true)
    expect((await response.text()).length, `${operationId} ${status} body`).toBeGreaterThan(0)
    return
  }

  const validate = validator(`${pointer}/content/${escape(mediaType)}/schema`)
  const body: unknown = await response.json()
  if (!validate(body)) {
    throw new Error(
      `${operationId} ${status} broke the contract: ${ajv.errorsText(validate.errors)}\n` +
        JSON.stringify(body, null, 2),
    )
  }
}

/**
 * Asserts a body is one named schema. `getProfile` answers `oneOf: [Profile, PublicCard]`, and
 * the coverage assertion counts statuses, not branches — this is how a test says which branch.
 */
export function expectSchema(name: string, body: unknown): void {
  const validate = validator(`/components/schemas/${name}`)
  if (!validate(body)) {
    throw new Error(`not a ${name}: ${ajv.errorsText(validate.errors)}\n${JSON.stringify(body, null, 2)}`)
  }
}
