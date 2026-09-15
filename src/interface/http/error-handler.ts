import type { ErrorHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ZodError } from 'zod'
import {
  InvalidProfileFieldError,
  ProfileAlreadyExistsError,
  ProfileNotFoundError,
} from '../../domain/errors.ts'
import type { Env } from './context.ts'
import { ForbiddenError, UnauthorizedError } from './errors.ts'

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
  if (error instanceof SyntaxError) {
    return { title: 'Malformed request body', status: 400, detail: 'the body is not valid JSON' }
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

export const errorHandler: ErrorHandler<Env> = (error, c) => {
  const problem = problemFor(error)

  if (problem === undefined) {
    // A 500 deliberately tells the client nothing useful, so this line is the only record
    // that the failure happened at all.
    c.get('log').error({ err: error }, 'unhandled error')
    return c.body(JSON.stringify({ title: 'Internal server error', status: 500 }), 500, {
      'content-type': 'application/problem+json',
    })
  }

  return c.body(JSON.stringify(problem), problem.status, {
    'content-type': 'application/problem+json',
  })
}
