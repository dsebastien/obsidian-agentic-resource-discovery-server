/**
 * The embedding seam.
 *
 * Turns text into dense vectors for semantic search. Kept deliberately small and
 * injectable so the fusion/ranking logic in {@link SemanticSearchBackend} can be
 * unit-tested with a deterministic fake, while the real implementation
 * ({@link TransformersEmbedder}) lazily loads an ONNX model at runtime.
 *
 * Implementations must return L2-normalised vectors of a fixed
 * {@link dimensions} length so the {@link VectorStore} can treat cosine
 * similarity as a plain dot product.
 */
export interface Embedder {
    /** Stable identifier for diagnostics (e.g. the model id). */
    readonly id: string
    /** Vector length every {@link embed} call produces. */
    readonly dimensions: number
    /**
     * Load whatever the embedder needs (model weights, runtime). Idempotent;
     * may download on first call. Resolves once {@link isReady} is true.
     */
    load(): Promise<void>
    /** Whether {@link embed} can currently run. */
    isReady(): boolean
    /** Embed each input into an L2-normalised vector. */
    embed(texts: string[]): Promise<Float32Array[]>
}
