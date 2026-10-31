import type { ErrorHandler, NotFoundHandler } from 'hono'
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

/** RFC 9457 problem details. `detail` is human prose — openapi.yaml says do not parse it. */
type Problem = { title: string; status: ContentfulStatusCode; detail?: string }

function firstIssue(error: ZodError): string {
  const issue = error.issues[0]
  if (issue === undefined) return 'the body does not match the expected shape'
  const where = issue.path.join('.')
  return where.length > 0 ? `${where}: ${issue.message}` : issue.message
}

/**
 * Domain and edge errors become the statuses openapi.yaml enumerates. Anything else is a 500.
 *
 * The split between 400 and 422 is the same split the validators make: a body that is not the
 * right *shape* is malformed, a value that breaks a §4 *rule* is unprocessable.
 */
function problemFor(error: Error): Problem | undefined {
  if (error instanceof ZodError) {
    return { title: 'Malformed request body', status: 400, detail: firstIssue(error) }
  }
  if (error instanceof MalformedBodyError) {
    return { title: 'Malformed request body', status: 400, detail: error.message }
  }
  if (error instanceof UnauthorizedError) {
    return { title: 'Unauthorized', status: 401, detail: error.message }
  }
  if (error instanceof ForbiddenError) {
    return { title: 'Forbidden', status: 403, detail: error.message }
  }
  if (error instanceof ProfileNotFoundError) {
    return { title: 'Profile not found', status: 404, detail: error.message }
  }
  if (error instanceof ProfileAlreadyExistsError) {
    return { title: 'Profile already exists', status: 409, detail: error.message }
  }
  if (error instanceof InvalidProfileFieldError) {
    return { title: 'Invalid field', status: 422, detail: error.message }
  }
  return undefined
}

/**
 * Takes the base logger because this is the one path that must never fail: `c.get('log')` is
 * unset if anything throws before the request-context middleware runs, and an error handler
 * that throws turns a logged 500 into a silent transport error.
 */
export function errorHandler(base: Logger): ErrorHandler<Env> {
  return (error, c) => {
  correlationIdOf(c)
  const problem = problemFor(error)

  if (problem === undefined) {
    // A 500 deliberately tells the client nothing useful, so this line is the only record
    // that the failure happened at all.
    ;(c.get('log') ?? base).error({ err: error }, 'unhandled error')
    return c.body(JSON.stringify({ title: 'Internal server error', status: 500 }), 500, {
      'content-type': 'application/problem+json',
    })
  }

  return c.body(JSON.stringify(problem), problem.status, {
    'content-type': 'application/problem+json',
  })
  }
}

/** An unmatched path, in the same shape as every other error this service returns. */
export const notFoundHandler: NotFoundHandler<Env> = (c) => {
  correlationIdOf(c)
  return c.body(JSON.stringify({ title: 'Not found', status: 404 }), 404, {
    'content-type': 'application/problem+json',
  })
}
