import type { SearchBackendConfig } from '../types/plugin-settings.intf'
import { TransformersEmbedder } from './embedding/transformers-embedder'
import { LexicalSearchBackend } from './lexical-search-backend'
import type { SearchBackend } from './search-backend'
import { SemanticSearchBackend } from './semantic-search-backend'

/**
 * Build the configured search backend.
 *
 * The lexical (MiniSearch BM25) backend is the always-available default — zero
 * download, fully in-process. `local-model` adds a hybrid
 * {@link SemanticSearchBackend} (lexical fused with ONNX sentence-embeddings via
 * RRF); the model is an opt-in lazy download and the backend degrades to
 * lexical-only until it loads — so selecting it never breaks search. The
 * remaining semantic backends (`qmd-sidecar`, `hosted-api`) are still deferred
 * and fall back to lexical. Each is a drop-in `SearchBackend` on this switch.
 */
export function createSearchBackend(config: SearchBackendConfig): SearchBackend {
    switch (config.kind) {
        case 'local-model':
            return new SemanticSearchBackend(
                new TransformersEmbedder({
                    modelId: config.modelId,
                    cacheDir: config.modelCacheDir
                })
            )
        case 'lexical':
        case 'qmd-sidecar':
        case 'hosted-api':
        default:
            return new LexicalSearchBackend()
    }
}
