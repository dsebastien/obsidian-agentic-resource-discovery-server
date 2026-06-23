import { HOSTED_EMBEDDING_PROVIDERS, type SearchBackendConfig } from '../../types/plugin-settings.intf'
import type { HttpEmbedderConfig } from './http-embedder'

/**
 * Hosted embedding providers that speak the OpenAI-compatible `/v1/embeddings`
 * shape, so the same {@link HttpEmbedder} drives them — only the base URL,
 * default model, and a required API key differ. `custom` covers any other
 * OpenAI-compatible gateway (Azure OpenAI, OpenRouter, a self-hosted proxy, …)
 * via an explicit base URL.
 */
export type HostedProvider = (typeof HOSTED_EMBEDDING_PROVIDERS)[number]

interface ProviderDefaults {
    baseUrl: string
    defaultModel: string
}

const PROVIDERS: Record<Exclude<HostedProvider, 'custom'>, ProviderDefaults> = {
    openai: { baseUrl: 'https://api.openai.com/v1', defaultModel: 'text-embedding-3-small' },
    voyage: { baseUrl: 'https://api.voyageai.com/v1', defaultModel: 'voyage-3' },
    jina: { baseUrl: 'https://api.jina.ai/v1', defaultModel: 'jina-embeddings-v3' }
}

/**
 * Resolve the {@link HttpEmbedderConfig} for the `hosted-api` backend from
 * settings: a base URL (from the provider, or `apiBaseUrl` for `custom`), the
 * chosen model (falling back to the provider default), and the API key.
 */
export function resolveHostedEmbedderConfig(config: SearchBackendConfig): HttpEmbedderConfig {
    const provider: HostedProvider = config.apiProvider ?? 'openai'
    if (provider === 'custom') {
        return {
            url: config.apiBaseUrl?.trim() ?? '',
            model: config.apiModel?.trim() ?? '',
            apiKey: config.apiKey
        }
    }
    const defaults = PROVIDERS[provider]
    return {
        url: defaults.baseUrl,
        model: config.apiModel?.trim() || defaults.defaultModel,
        apiKey: config.apiKey
    }
}
