import { describe, it, expect } from 'bun:test'
import { TransformersEmbedder } from './transformers-embedder'

describe('TransformersEmbedder', () => {
    it('reports the model id and a default dimension before loading', () => {
        const embedder = new TransformersEmbedder({ modelId: 'Xenova/all-MiniLM-L6-v2' })
        expect(embedder.id).toBe('Xenova/all-MiniLM-L6-v2')
        expect(embedder.dimensions).toBe(384)
        expect(embedder.isReady()).toBe(false)
    })

    it('rejects load() cleanly when @huggingface/transformers is not installed', async () => {
        // The heavy library is intentionally not a bundled dependency, so this
        // is the real production path until someone ships it. It must reject
        // with an Error (so SemanticSearchBackend can degrade to lexical), and
        // must not leave the embedder marked ready.
        const embedder = new TransformersEmbedder({ modelId: 'Xenova/all-MiniLM-L6-v2' })
        const error = await embedder.load().then(
            () => undefined,
            (e: unknown) => e
        )
        expect(error).toBeInstanceOf(Error)
        expect(embedder.isReady()).toBe(false)
    })

    it('throws if embed() is called before a successful load', async () => {
        const embedder = new TransformersEmbedder({ modelId: 'Xenova/all-MiniLM-L6-v2' })
        const error = await embedder.embed(['hello']).then(
            () => undefined,
            (e: unknown) => e
        )
        expect(error).toBeInstanceOf(Error)
    })
})
