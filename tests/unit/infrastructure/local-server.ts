import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'

export type Received = { method: string; url: string; headers: IncomingHttpHeaders; body: string }
/** What the server answers each request with. 'hang' never answers, to exercise timeouts. */
export type Reply = { status: number; json?: unknown } | 'hang'

/**
 * A real HTTP server on a free port, standing in for Identity, Buddy Discovery or object storage. It records
 * what reached it, so a test asserts on the wire rather than on a mock of fetch.
 */
export async function localServer(
  respond: (received: Received, index: number) => Reply,
): Promise<{ url: string; received: Received[]; close: () => Promise<void> }> {
  const received: Received[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => (body += chunk))
    request.on('end', () => {
      const entry = { method: request.method ?? '', url: request.url ?? '', headers: request.headers, body }
      received.push(entry)
      const reply = respond(entry, received.length - 1)
      if (reply === 'hang') return
      if (reply.json === undefined) {
        response.writeHead(reply.status).end()
        return
      }
      response.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify(reply.json))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/`,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
