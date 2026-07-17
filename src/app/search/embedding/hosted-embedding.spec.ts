import { describe, it, expect } from 'bun:test'
import { SearchBackendConfigSchema } from '../../types/plugin-settings.intf'
import { resolveHostedEmbedderConfig } from './hosted-embedding'

const cfg = (over: object = {}) => SearchBackendConfigSchema.parse({ kind: 'hosted-api', ...over })

describe('resolveHostedEmbedderConfig', () => {
    it('maps openai to its base URL and default model', () => {
        const r = resolveHostedEmbedderConfig(cfg({ apiProvider: 'openai', apiKey: 'sk-1' }))
        expect(r.url).toBe('https://api.openai.com/v1')
        expect(r.model).toBe('text-embedding-3-small')
        expect(r.apiKey).toBe('sk-1')
    })

    it('maps voyage and jina to their endpoints', () => {
        expect(resolveHostedEmbedderConfig(cfg({ apiProvider: 'voyage' })).url).toBe(
            'https://api.voyageai.com/v1'
        )
        expect(resolveHostedEmbedderConfig(cfg({ apiProvider: 'jina' })).url).toBe(
            'https://api.jina.ai/v1'
        )
    })

    it('prefers an explicit model over the provider default', () => {
        const r = resolveHostedEmbedderConfig(
            cfg({ apiProvider: 'openai', apiModel: 'text-embedding-3-large' })
        )
        expect(r.model).toBe('text-embedding-3-large')
    })

    it('uses apiBaseUrl for the custom provider', () => {
        const r = resolveHostedEmbedderConfig(
            cfg({
                apiProvider: 'custom',
                apiBaseUrl: 'https://gw.example/v1',
                apiModel: 'embed-1',
                apiKey: 'k'
            })
        )
        expect(r.url).toBe('https://gw.example/v1')
        expect(r.model).toBe('embed-1')
        expect(r.apiKey).toBe('k')
    })

    it('defaults to openai when no provider is set', () => {
        const r = resolveHostedEmbedderConfig(
            SearchBackendConfigSchema.parse({ kind: 'hosted-api' })
        )
        expect(r.url).toBe('https://api.openai.com/v1')
    })
})
