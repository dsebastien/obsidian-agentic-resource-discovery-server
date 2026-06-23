import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { RegistryRequest, RouteHandler } from './router'

/**
 * Thin node:http adapter over a {@link RouteHandler}.
 *
 * Its only job is transport: translate an incoming socket request into a
 * {@link RegistryRequest}, hand it to the (pure, fully-tested) router, and write
 * the {@link RegistryResponse} back. Binds to loopback only. All behaviour lives
 * in the router; this class owns the socket lifecycle.
 */
const MAX_LISTEN_RETRIES = 3
const LISTEN_RETRY_MS = 500

export class ArdHttpServer {
    private server: Server | null = null

    constructor(private readonly handler: RouteHandler) {}

    async start(port: number, bindAddress = '127.0.0.1'): Promise<void> {
        if (this.server) {
            await this.stop()
        }
        // Retry EADDRINUSE a few times: on hot-reload the OS can lag releasing
        // the previous listener for a few hundred ms.
        for (let attempt = 0; ; attempt++) {
            try {
                this.server = await listenOnce(this.handler, port, bindAddress)
                return
            } catch (error) {
                const code = (error as { code?: string }).code
                if (code !== 'EADDRINUSE' || attempt >= MAX_LISTEN_RETRIES) {
                    throw error
                }
                await new Promise<void>((resolve) => window.setTimeout(resolve, LISTEN_RETRY_MS))
            }
        }
    }

    async stop(): Promise<void> {
        const server = this.server
        if (!server) {
            return
        }
        this.server = null
        // Drop keep-alive connections immediately so close() resolves promptly.
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
    }

    get isRunning(): boolean {
        return this.server?.listening ?? false
    }

    /** The actual bound port (useful when starting on port 0). */
    get port(): number | null {
        const address = this.server?.address()
        return address && typeof address === 'object' ? address.port : null
    }
}

/** Create + bind a server once, resolving with it or rejecting on listen error. */
function listenOnce(handler: RouteHandler, port: number, bindAddress: string): Promise<Server> {
    return new Promise<Server>((resolve, reject) => {
        const server = createServer((req, res) => {
            void handleRequest(handler, req, res)
        })
        const onError = (err: Error): void => reject(err)
        server.once('error', onError)
        server.listen(port, bindAddress, () => {
            server.removeListener('error', onError)
            resolve(server)
        })
    })
}

async function handleRequest(
    handler: RouteHandler,
    req: IncomingMessage,
    res: ServerResponse
): Promise<void> {
    try {
        const response = await handler(await toRegistryRequest(req))
        res.writeHead(response.status, response.headers)
        res.end(response.body)
    } catch {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ errorCode: 'INTERNAL', message: 'Internal server error.' }))
    }
}

async function toRegistryRequest(req: IncomingMessage): Promise<RegistryRequest> {
    const url = new URL(req.url ?? '/', 'http://localhost')

    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) {
            headers[key] = value.join(', ')
        } else if (typeof value === 'string') {
            headers[key] = value
        }
    }

    const chunks: Uint8Array[] = []
    for await (const chunk of req) {
        chunks.push(chunk as Uint8Array)
    }

    return {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        headers,
        body: Buffer.concat(chunks).toString('utf-8')
    }
}
