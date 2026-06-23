import type { SearchBackendConfig } from '../types/plugin-settings.intf'
import { LexicalSearchBackend } from './lexical-search-backend'
import type { SearchBackend } from './search-backend'

/**
 * Build the configured search backend.
 *
 * The lexical (MiniSearch BM25) backend is the always-available default — zero
 * download, fully in-process. The semantic backends (`local-model` via a small
 * ONNX embedding model, `qmd-sidecar`, `hosted-api`) are intentionally deferred
 * to keep the plugin free of mandatory model downloads (the headline non-goal of
 * v1); selecting one today degrades gracefully to lexical rather than failing.
 * Each future backend is a drop-in `SearchBackend` added to this switch.
 */
export function createSearchBackend(config: SearchBackendConfig): SearchBackend {
    switch (config.kind) {
        case 'lexical':
        case 'local-model':
        case 'qmd-sidecar':
        case 'hosted-api':
        default:
            return new LexicalSearchBackend()
    }
}
