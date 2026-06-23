import type { Embedder } from './embedder'

/**
 * Minimal structural view of the bits of `@huggingface/transformers` we touch.
 * Declared locally so this file compiles whether or not the (heavy, optional)
 * library is installed/bundled — it is pulled in via a lazy dynamic import.
 */
interface TransformersModule {
    env: { allowRemoteModels: boolean; cacheDir?: string }
    pipeline: (task: 'feature-extraction', model: string) => Promise<FeatureExtractionPipeline>
}

type FeatureExtractionPipeline = (
    texts: string[],
    options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ dims: number[]; data: Float32Array | number[] }>

/** Default embedding dimension for all-MiniLM-L6-v2 until the model reports one. */
const DEFAULT_DIMENSIONS = 384

/**
 * Real {@link Embedder} backed by a quantised ONNX sentence-transformer loaded
 * through `@huggingface/transformers` (Transformers.js).
 *
 * The library is imported lazily via a non-literal specifier so it is **not**
 * bundled into `main.js` and adds zero weight until a build actually ships it;
 * if it (or the model download) is unavailable at runtime, {@link load} rejects
 * and {@link SemanticSearchBackend} degrades to lexical-only search. The model
 * (~23 MB int8) downloads on first {@link load} and is cached thereafter — this
 * is the only mandatory-download path, and it is strictly opt-in.
 */
export class TransformersEmbedder implements Embedder {
    readonly id: string
    private dims = DEFAULT_DIMENSIONS
    private extractor: FeatureExtractionPipeline | null = null
    private loading: Promise<void> | null = null

    constructor(private readonly options: { modelId: string; cacheDir?: string }) {
        this.id = options.modelId
    }

    get dimensions(): number {
        return this.dims
    }

    isReady(): boolean {
        return this.extractor !== null
    }

    load(): Promise<void> {
        if (this.extractor) {
            return Promise.resolve()
        }
        // Coalesce concurrent loads onto one in-flight download.
        this.loading ??= this.doLoad()
        return this.loading
    }

    private async doLoad(): Promise<void> {
        try {
            const mod = await importTransformers()
            mod.env.allowRemoteModels = true
            if (this.options.cacheDir) {
                mod.env.cacheDir = this.options.cacheDir
            }
            this.extractor = await mod.pipeline('feature-extraction', this.options.modelId)
        } catch (error) {
            this.loading = null // allow a later retry
            throw error instanceof Error ? error : new Error(String(error))
        }
    }

    async embed(texts: string[]): Promise<Float32Array[]> {
        if (!this.extractor) {
            throw new Error('TransformersEmbedder.embed called before load()')
        }
        if (texts.length === 0) {
            return []
        }
        const output = await this.extractor(texts, { pooling: 'mean', normalize: true })
        const rows = output.dims[0] ?? texts.length
        const width = output.dims[1] ?? this.dims
        this.dims = width
        const flat = output.data
        const vectors: Float32Array[] = []
        for (let r = 0; r < rows; r++) {
            const start = r * width
            const slice = new Float32Array(width)
            for (let c = 0; c < width; c++) {
                slice[c] = Number(flat[start + c] ?? 0)
            }
            vectors.push(slice)
        }
        return vectors
    }
}

/**
 * Import `@huggingface/transformers` through a runtime-computed specifier so the
 * bundler leaves it as a runtime resolution (no static bundling, no build-time
 * dependency). Throws cleanly when the library isn't present.
 */
async function importTransformers(): Promise<TransformersModule> {
    const specifier = ['@huggingface', 'transformers'].join('/')
    return (await import(specifier)) as TransformersModule
}
