import { requestUrl } from 'obsidian'
import type { Embedder } from './embedder'

/** Minimal HTTP seam so the embedder is unit-testable without a real server. */
export type EmbeddingHttpClient = (req: {
    url: string
    headers: Record<string, string>
    body: string
}) => Promise<{ status: number; json: unknown }>

export interface HttpEmbedderConfig {
    /** Base or full embeddings URL, e.g. `http://localhost:11434/v1`. */
    url: string
    /** Model name the server should use, e.g. `nomic-embed-text`. */
    model: string
    /** Optional bearer token (some local servers / hosted gateways require one). */
    apiKey?: string
}

/** Largest batch sent in one request — keeps payloads modest on big catalogs. */
const BATCH_SIZE = 64

/**
 * {@link Embedder} backed by a local (or any) OpenAI-compatible `/v1/embeddings`
 * HTTP endpoint — Ollama, LM Studio, llama.cpp server, LocalAI, vLLM, etc.
 *
 * Nothing is bundled and nothing is downloaded by the plugin: the user points
 * this at an embedding server they already run. The HTTP call goes through
 * Obsidian's {@link requestUrl} (no CORS, satisfies the community lint rule), but
 * the client is injectable so the request/response handling is fully unit-tested
 * with a fake. {@link load} probes the endpoint once to validate connectivity
 * and learn the vector width; failures reject so {@link SemanticSearchBackend}
 * degrades to lexical-only search.
 */
export class HttpEmbedder implements Embedder {
    readonly id: string
    private readonly endpoint: string
    private dims = 0
    private ready = false

    constructor(
        private readonly config: HttpEmbedderConfig,
        private readonly client: EmbeddingHttpClient = requestUrlClient
    ) {
        this.id = `${config.model} @ ${config.url}`
        this.endpoint = embeddingsEndpoint(config.url)
    }

    get dimensions(): number {
        return this.dims
    }

    isReady(): boolean {
        return this.ready
    }

    async load(): Promise<void> {
        const [probe] = await this.request(['embedding dimension probe'])
        if (!probe || probe.length === 0) {
            throw new Error(`Embedding server returned no vector from ${this.endpoint}`)
        }
        this.dims = probe.length
        this.ready = true
    }

    async embed(texts: string[]): Promise<Float32Array[]> {
        if (texts.length === 0) {
            return []
        }
        const vectors: Float32Array[] = []
        for (let start = 0; start < texts.length; start += BATCH_SIZE) {
            const batch = await this.request(texts.slice(start, start + BATCH_SIZE))
            vectors.push(...batch)
        }
        return vectors
    }

    /** POST one batch and return L2-normalised vectors in input order. */
    private async request(texts: string[]): Promise<Float32Array[]> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (this.config.apiKey) {
            headers['Authorization'] = `Bearer ${this.config.apiKey}`
        }
        const { status, json } = await this.client({
            url: this.endpoint,
            headers,
            body: JSON.stringify({ model: this.config.model, input: texts })
        })
        if (status < 200 || status >= 300) {
            throw new Error(`Embedding server responded ${status} from ${this.endpoint}`)
        }
        return parseEmbeddings(json, texts.length).map(normalise)
    }
}

/** The default client: Obsidian's requestUrl, never throwing on HTTP status. */
const requestUrlClient: EmbeddingHttpClient = async (req) => {
    const response = await requestUrl({
        url: req.url,
        method: 'POST',
        headers: req.headers,
        body: req.body,
        throw: false
    })
    let json: unknown
    try {
        json = response.json
    } catch {
        json = undefined
    }
    return { status: response.status, json }
}

/** Ensure the URL targets the `/embeddings` resource exactly once. */
function embeddingsEndpoint(url: string): string {
    const trimmed = url.replace(/\/+$/, '')
    // Already points at an embeddings endpoint (terminal `/embeddings`, or a
    // custom gateway with `/embeddings/...` mid-path) → use it as-is.
    if (trimmed.endsWith('/embeddings') || trimmed.includes('/embeddings/')) {
        return trimmed
    }
    return `${trimmed}/embeddings`
}

/** Extract `data[].embedding` ordered by `index`, validating the shape. */
function parseEmbeddings(json: unknown, expected: number): number[][] {
    if (typeof json !== 'object' || json === null || !('data' in json)) {
        throw new Error('Embedding response missing "data" array')
    }
    const data = (json as { data: unknown }).data
    if (!Array.isArray(data) || data.length !== expected) {
        throw new Error('Embedding response "data" length does not match the request')
    }
    const rows = data.map((row, position) => {
        if (typeof row !== 'object' || row === null) {
            throw new Error('Embedding response row is not an object')
        }
        const { index, embedding } = row as { index?: unknown; embedding?: unknown }
        if (!Array.isArray(embedding) || embedding.some((n) => typeof n !== 'number')) {
            throw new Error('Embedding response row has no numeric "embedding" array')
        }
        // Use the server's `index` only when it actually provides distinct ones;
        // otherwise (e.g. Ollama omits `index`) trust the response order, so a
        // missing field can't collapse every row to index 0 and risk a mis-map.
        return { index: typeof index === 'number' ? index : position, embedding: embedding as number[] }
    })
    rows.sort((a, b) => a.index - b.index)
    return rows.map((row) => row.embedding)
}

/** L2-normalise so the VectorStore's dot product equals cosine similarity. */
function normalise(values: number[]): Float32Array {
    const vec = Float32Array.from(values)
    let sumSq = 0
    for (const v of vec) {
        sumSq += v * v
    }
    const norm = Math.sqrt(sumSq) || 1
    for (let i = 0; i < vec.length; i++) {
        vec[i] = (vec[i] ?? 0) / norm
    }
    return vec
}
