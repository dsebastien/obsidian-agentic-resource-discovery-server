import type { SearchBackendConfig } from '../types/plugin-settings.intf'
import { resolveHostedEmbedderConfig } from './embedding/hosted-embedding'
import { HttpEmbedder } from './embedding/http-embedder'
import { LexicalSearchBackend } from './lexical-search-backend'
import type { SearchBackend } from './search-backend'
import { SemanticSearchBackend } from './semantic-search-backend'

/**
 * Build the configured search backend.
 *
 * The lexical (MiniSearch BM25) backend is the always-available default — zero
 * download, fully in-process. `local-model` adds a hybrid
 * {@link SemanticSearchBackend} (lexical fused with dense embeddings via RRF)
 * sourced from a local OpenAI-compatible embedding server the user already runs
 * (Ollama, LM Studio, …) — nothing is bundled or downloaded by the plugin, and
 * the backend degrades to lexical-only if the server is unreachable, so
 * selecting it never breaks search. `hosted-api` is the same hybrid backend
 * pointed at a remote OpenAI-compatible embedding API (BYO key). `qmd-sidecar`
 * is still deferred and falls back to lexical. Each is a drop-in `SearchBackend`
 * on this switch.
 */
export function createSearchBackend(config: SearchBackendConfig): SearchBackend {
    switch (config.kind) {
        case 'local-model':
            return new SemanticSearchBackend(
                new HttpEmbedder({
                    url: config.embeddingServerUrl,
                    model: config.embeddingModel
                })
            )
        case 'hosted-api':
            return new SemanticSearchBackend(new HttpEmbedder(resolveHostedEmbedderConfig(config)))
        case 'lexical':
        case 'qmd-sidecar':
        default:
            return new LexicalSearchBackend()
    }
}
