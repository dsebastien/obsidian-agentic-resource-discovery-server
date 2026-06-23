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
export class ArdHttpServer {
    private server: Server | null = null

    constructor(private readonly handler: RouteHandler) {}

    async start(port: number, bindAddress = '127.0.0.1'): Promise<void> {
        if (this.server) {
            await this.stop()
        }
        const server = createServer((req, res) => {
            void this.handle(req, res)
        })
        this.server = server

        await new Promise<void>((resolve, reject) => {
            const onError = (err: Error): void => reject(err)
            server.once('error', onError)
            server.listen(port, bindAddress, () => {
                server.removeListener('error', onError)
                resolve()
            })
        })
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

    private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        try {
            const request = await toRegistryRequest(req)
            const response = await this.handler(request)
            res.writeHead(response.status, response.headers)
            res.end(response.body)
        } catch {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ errorCode: 'INTERNAL', message: 'Internal server error.' }))
        }
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
