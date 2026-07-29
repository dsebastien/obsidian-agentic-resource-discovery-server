import { LEXICAL_INDEX_CONFIG } from '../search/lexical-search-backend'

/**
 * The `registry` API injected into the Code Mode sandbox.
 *
 * Plain ES5-flavoured source evaluated inside the QuickJS isolate: it closes
 * over the pre-injected `__CATALOG__` and exposes `listAll` / `get` / `search`.
 *
 * `search` deliberately builds a **MiniSearch index with the same configuration
 * and the same documents as {@link LexicalSearchBackend}**, evaluating the
 * library's own source (`__MINISEARCH_SRC__`) inside the isolate. That keeps
 * in-sandbox ranking identical to `POST /search` instead of the substring
 * heuristic this used to ship — without opening a host bridge, so the isolate
 * stays network- and filesystem-free. The index is built lazily on first search,
 * so code that only filters or aggregates never pays for it.
 */
export const REGISTRY_SHIM = `
(function () {
    var CATALOG = globalThis.__CATALOG__;
    var byId = Object.create(null);
    for (var i = 0; i < CATALOG.length; i++) {
        byId[CATALOG[i].identifier] = CATALOG[i];
    }

    function asArray(value) {
        if (value === undefined || value === null) return [];
        return Array.isArray(value) ? value : [value];
    }

    // Mirrors matchesFilter() on the host: any-match over type/tags/capabilities.
    function matches(entry, filter) {
        if (!filter) return true;
        var types = asArray(filter.type);
        if (types.length && types.indexOf(entry.type) === -1) return false;
        var tags = asArray(filter.tags).concat(asArray(filter.tag));
        var entryTags = entry.tags || [];
        if (tags.length && !tags.some(function (t) { return entryTags.indexOf(t) !== -1; })) {
            return false;
        }
        var caps = asArray(filter.capabilities);
        var entryCaps = entry.capabilities || [];
        if (caps.length && !caps.some(function (c) { return entryCaps.indexOf(c) !== -1; })) {
            return false;
        }
        return true;
    }

    // Mirrors terminalSegment() + toIndexDoc() on the host.
    function terminalSegment(urn) {
        var parts = String(urn).split(':');
        return (parts[parts.length - 1] || '').replace(/-/g, ' ');
    }

    function toIndexDoc(entry) {
        return {
            id: entry.identifier,
            displayName: entry.displayName || '',
            name: terminalSegment(entry.identifier),
            description: entry.description || '',
            tags: (entry.tags || []).join(' '),
            capabilities: (entry.capabilities || []).join(' '),
            representativeQueries: (entry.representativeQueries || []).join(' ')
        };
    }

    var index = null;
    function getIndex() {
        if (index) return index;
        if (typeof globalThis.MiniSearch !== 'function') {
            // Indirect eval: evaluate the bundled library in global scope.
            (0, eval)(globalThis.__MINISEARCH_SRC__);
        }
        index = new globalThis.MiniSearch(globalThis.__LEXICAL_CONFIG__);
        index.addAll(CATALOG.map(toIndexDoc));
        return index;
    }

    // Mirrors normalizeScore() on the host (0-100, best match capped at 85).
    function normalizeScore(score, topScore) {
        return Math.min(100, Math.max(1, Math.round((score / topScore) * 85)));
    }

    globalThis.registry = {
        listAll: function (filter) {
            return CATALOG.filter(function (entry) { return matches(entry, filter); });
        },
        get: function (identifier) {
            return byId[identifier] || null;
        },
        search: function (query, opts) {
            var options = opts || {};
            var limit = options.limit || 10;
            var text = String(query === undefined || query === null ? '' : query).trim();
            if (!text) return [];
            var raw = getIndex().search(text);
            var topScore = Math.max(raw.length ? raw[0].score : 0, Number.EPSILON);
            var results = [];
            for (var j = 0; j < raw.length && results.length < limit; j++) {
                var entry = byId[raw[j].id];
                if (!entry || !matches(entry, options.filter)) continue;
                results.push(
                    Object.assign({}, entry, { score: normalizeScore(raw[j].score, topScore) })
                );
            }
            return results;
        }
    };
})();
`

/** The lexical ranking configuration handed to the in-sandbox MiniSearch. */
export const LEXICAL_CONFIG_JSON = JSON.stringify(LEXICAL_INDEX_CONFIG)
