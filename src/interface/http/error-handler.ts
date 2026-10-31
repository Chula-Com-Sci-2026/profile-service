import type { Context, ErrorHandler, NotFoundHandler } from 'hono'
import type { Logger } from 'pino'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ZodError } from 'zod'
import {
  InvalidProfileFieldError,
  ProfileAlreadyExistsError,
  ProfileNotFoundError,
} from '../../domain/errors.ts'
import type { Env } from './context.ts'
import { ForbiddenError, MalformedBodyError, UnauthorizedError } from './errors.ts'
import { correlationIdOf } from './request-context.ts'

/**
 * Every error this service answers — the team frontend's `ApiErrorBody`, exactly. `code` is for
 * code to branch on; `message` is prose for people, never parsed (openapi.yaml says so).
 */
export type ApiError = {
  code: string
  message: string
  correlationId: string
  fieldErrors?: Record<string, string>
}

type Failure = {
  status: ContentfulStatusCode
  code: string
  message: string
  fieldErrors?: Record<string, string>
}

/**
 * One message per field, keyed by its name in the request body — a problem inside a field is
 * keyed by the field itself (`area`, not `area.latitude`). Every malformed field at once, the
 * first message for each. An unknown field is named too; a body that is not an object names none.
 */
function fieldErrorsOf(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {}
  const name = (field: string, message: string): void => {
    if (!(field in fields)) fields[field] = message
  }
  for (const issue of error.issues) {
    // Only an unknown key at the top of the body is a field of its own; one inside a field (an
    // `altitude` in `area`) is that field's problem, and falls through to be keyed by it.
    if (issue.code === 'unrecognized_keys' && issue.path.length === 0) {
      for (const key of issue.keys) name(key, 'is not a field this request accepts')
      continue
    }
    const field = issue.path[0]
    if (typeof field === 'string') name(field, issue.message)
  }
  return fields
}

/**
 * Domain and edge errors become the statuses openapi.yaml enumerates. Anything else is a 500.
 *
 * A body of the wrong *shape* and a value that breaks a §4 *rule* are both 422: the frontend
 * treats them alike. The validators still split them, because each check has one home — shape at
 * the edge, rules in the domain — and a domain rule reports the first one it finds broken.
 */
function failureFor(error: Error): Failure | undefined {
  if (error instanceof ZodError) {
    return { status: 422, code: 'validation_failed', message: 'the request body is not valid', fieldErrors: fieldErrorsOf(error) }
  }
  if (error instanceof MalformedBodyError) {
    return { status: 422, code: 'validation_failed', message: error.message }
  }
  if (error instanceof InvalidProfileFieldError) {
    return { status: 422, code: 'validation_failed', message: error.message, fieldErrors: { [error.field]: error.rule } }
  }
  if (error instanceof UnauthorizedError) {
    return { status: 401, code: 'unauthorized', message: error.message }
  }
  if (error instanceof ForbiddenError) {
    return { status: 403, code: 'forbidden', message: error.message }
  }
  if (error instanceof ProfileNotFoundError) {
    return { status: 404, code: 'profile_not_found', message: error.message }
  }
  if (error instanceof ProfileAlreadyExistsError) {
    return { status: 409, code: 'profile_already_exists', message: error.message }
  }
  return undefined
}

function answer(c: Context<Env>, { status, code, message, fieldErrors }: Failure): Response {
  const body: ApiError = {
    code,
    message,
    correlationId: correlationIdOf(c),
    ...(fieldErrors !== undefined && Object.keys(fieldErrors).length > 0 && { fieldErrors }),
  }
  return c.json(body, status)
}

/**
 * Takes the base logger because this is the one path that must never fail: `c.get('log')` is
 * unset if anything throws before the request-context middleware runs, and an error handler
 * that throws turns a logged 500 into a silent transport error.
 */
export function errorHandler(base: Logger): ErrorHandler<Env> {
  return (error, c) => {
    const failure = failureFor(error)
    if (failure !== undefined) return answer(c, failure)

    // A 500 deliberately tells the client nothing useful, so this line is the only record
    // that the failure happened at all.
    ;(c.get('log') ?? base).error({ err: error }, 'unhandled error')
    return answer(c, { status: 500, code: 'internal_error', message: 'something went wrong on our side' })
  }
}

/** An unmatched path, in the same shape as every other error this service returns. */
export const notFoundHandler: NotFoundHandler<Env> = (c) =>
  answer(c, { status: 404, code: 'not_found', message: 'there is no such route' })
