import { describe, it, expect } from 'bun:test'
import { HttpEmbedder, type EmbeddingHttpClient } from './http-embedder'

/** Build a fake client that returns OpenAI-shaped embeddings for each input. */
function fakeClient(
    vectorFor: (text: string) => number[],
    onRequest?: (req: { url: string; headers: Record<string, string>; body: string }) => void
): EmbeddingHttpClient {
    return async (req) => {
        onRequest?.(req)
        const parsed = JSON.parse(req.body) as { input: string[] }
        return {
            status: 200,
            json: {
                data: parsed.input.map((text, index) => ({ index, embedding: vectorFor(text) }))
            }
        }
    }
}

describe('HttpEmbedder', () => {
    it('posts OpenAI-compatible embedding requests to the configured endpoint', async () => {
        const seen: { url: string; headers: Record<string, string>; body: string }[] = []
        const embedder = new HttpEmbedder(
            { url: 'http://localhost:11434/v1', model: 'nomic-embed-text', apiKey: 'secret' },
            fakeClient(() => [3, 4], (req) => seen.push(req))
        )
        await embedder.load()
        expect(embedder.isReady()).toBe(true)
        expect(embedder.dimensions).toBe(2)

        await embedder.embed(['hello', 'world'])
        const last = seen[seen.length - 1]
        expect(last?.url).toBe('http://localhost:11434/v1/embeddings')
        expect(last?.headers['Authorization']).toBe('Bearer secret')
        const body = JSON.parse(last?.body ?? '{}') as { model: string; input: string[] }
        expect(body.model).toBe('nomic-embed-text')
        expect(body.input).toEqual(['hello', 'world'])
    })

    it('returns L2-normalised vectors', async () => {
        const embedder = new HttpEmbedder(
            { url: 'http://x/v1/embeddings', model: 'm' },
            fakeClient(() => [3, 4]) // magnitude 5 → normalises to [0.6, 0.8]
        )
        await embedder.load()
        const [vec] = await embedder.embed(['anything'])
        expect(vec?.[0]).toBeCloseTo(0.6, 5)
        expect(vec?.[1]).toBeCloseTo(0.8, 5)
        expect(Math.hypot(...(vec ?? []))).toBeCloseTo(1, 5)
    })

    it('preserves order via the response index field', async () => {
        const client: EmbeddingHttpClient = async (req) => {
            const parsed = JSON.parse(req.body) as { input: string[] }
            // Return rows out of order; index must drive reassembly.
            const rows = parsed.input.map((_t, i) => ({ index: i, embedding: [i + 1, 0] }))
            return { status: 200, json: { data: [...rows].reverse() } }
        }
        const embedder = new HttpEmbedder({ url: 'http://x/v1', model: 'm' }, client)
        await embedder.load()
        const vecs = await embedder.embed(['a', 'b', 'c'])
        expect(vecs.map((v) => Math.round(v[0] ?? 0))).toEqual([1, 1, 1]) // each normalised [1,0]
        expect(vecs).toHaveLength(3)
    })

    it('preserves response order when the server omits index (no collapse to 0)', async () => {
        // Ollama-style: no `index` field. Distinct vectors must stay in order.
        const client: EmbeddingHttpClient = async (req) => {
            const parsed = JSON.parse(req.body) as { input: string[] }
            const vecs = [
                [1, 0],
                [0, 1],
                [1, 1]
            ]
            return { status: 200, json: { data: parsed.input.map((_t, i) => ({ embedding: vecs[i] })) } }
        }
        const embedder = new HttpEmbedder({ url: 'http://x/v1', model: 'm' }, client)
        await embedder.load()
        const [a, b] = await embedder.embed(['a', 'b'])
        expect(a?.[0]).toBeCloseTo(1, 5) // first row normalises to [1,0]
        expect(b?.[1]).toBeCloseTo(1, 5) // second row normalises to [0,1]
    })

    it('appends /embeddings only when the url lacks it', async () => {
        const urls: string[] = []
        const spy = fakeClient(
            () => [1],
            (req) => urls.push(req.url)
        )
        await new HttpEmbedder({ url: 'http://x/v1/', model: 'm' }, spy).load()
        await new HttpEmbedder({ url: 'http://x/v1/embeddings', model: 'm' }, spy).load()
        expect(urls).toEqual(['http://x/v1/embeddings', 'http://x/v1/embeddings'])
    })

    it('rejects load() when the server returns a non-2xx status', async () => {
        const client: EmbeddingHttpClient = async () => ({ status: 500, json: { error: 'boom' } })
        const embedder = new HttpEmbedder({ url: 'http://x/v1', model: 'm' }, client)
        const error = await embedder.load().then(
            () => undefined,
            (e: unknown) => e
        )
        expect(error).toBeInstanceOf(Error)
        expect(embedder.isReady()).toBe(false)
    })

    it('rejects load() when the client throws (server unreachable)', async () => {
        const client: EmbeddingHttpClient = async () => {
            throw new Error('ECONNREFUSED')
        }
        const embedder = new HttpEmbedder({ url: 'http://x/v1', model: 'm' }, client)
        const error = await embedder.load().then(
            () => undefined,
            (e: unknown) => e
        )
        expect(error).toBeInstanceOf(Error)
        expect(embedder.isReady()).toBe(false)
    })

    it('rejects on a malformed response shape', async () => {
        const client: EmbeddingHttpClient = async () => ({ status: 200, json: { nope: true } })
        const embedder = new HttpEmbedder({ url: 'http://x/v1', model: 'm' }, client)
        const error = await embedder.load().then(
            () => undefined,
            (e: unknown) => e
        )
        expect(error).toBeInstanceOf(Error)
    })

    it('returns [] for an empty input without calling the server', async () => {
        let calls = 0
        const client: EmbeddingHttpClient = async (req) => {
            calls++
            const parsed = JSON.parse(req.body) as { input: string[] }
            return { status: 200, json: { data: parsed.input.map((_t, index) => ({ index, embedding: [1] })) } }
        }
        const embedder = new HttpEmbedder({ url: 'http://x/v1', model: 'm' }, client)
        await embedder.load() // one probe call
        const afterLoad = calls
        expect(await embedder.embed([])).toEqual([])
        expect(calls).toBe(afterLoad) // embed([]) made no further request
    })
})
