import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Ajv2020 } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

/**
 * `docs/profile-events.schema.json` as a test oracle: the events this service writes must obey the
 * document, the way responses obey openapi.yaml. The file is in the team's format, so it states
 * its ids and times as `format: uuid` and `format: date-time`; Ajv only checks a format it has been
 * given, so `ajv-formats` is what makes those two checks real.
 *
 * Shared by the unit suite and the integration suite, which reads the events back out of the
 * outbox.
 */
const path = fileURLToPath(new URL('../../../docs/profile-events.schema.json', import.meta.url))

/** The file, parsed — for a test that compares it with openapi.yaml. */
export const eventSchema = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>

const ajv = new Ajv2020({ strict: false, allErrors: true })
// Under `nodenext` the default import is typed as the CommonJS module; its `default` is the plugin.
addFormats.default(ajv)
const validate = ajv.compile(eventSchema)

/** Does this event obey the file? */
export function obeysEventSchema(event: unknown): boolean {
  return validate(event)
}

/** Throws, naming every broken rule, unless the event obeys the file. */
export function expectProfileEvent(event: unknown): void {
  if (!validate(event)) {
    throw new Error(
      `the event broke docs/profile-events.schema.json: ${ajv.errorsText(validate.errors)}\n` +
        JSON.stringify(event, null, 2),
    )
  }
}
