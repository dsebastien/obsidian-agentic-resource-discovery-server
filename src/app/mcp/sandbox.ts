import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from 'quickjs-emscripten-core'
import variant from '@jitl/quickjs-singlefile-cjs-release-sync'

/**
 * Code Mode sandbox.
 *
 * Runs model-written JavaScript against the catalog inside a QuickJS WASM
 * isolate — no host access (no fetch, fs, require, process), a wall-clock
 * timeout, and a memory cap. The catalog metadata is pre-injected as a JSON
 * global and exposed through a synchronous `registry` API (search/get/listAll),
 * so the model can discover, filter, and aggregate resources in a single call
 * without streaming hundreds of entries through its context window.
 *
 * Threat model: accidental harmful code from the model (infinite loops, large
 * allocations), not an adversarial attacker. The WASM boundary + limits cover
 * both.
 */

export type SandboxResult = { ok: true; value: unknown } | { ok: false; error: string }

export interface SandboxInput {
    /** Catalog entry metadata (no skill bodies) made available to the code. */
    catalog: unknown[]
}

export interface SandboxOptions {
    timeoutMs?: number
    memoryLimitBytes?: number
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MEMORY_LIMIT = 64 * 1024 * 1024
const MAX_STACK_SIZE = 512 * 1024

let modulePromise: Promise<QuickJSWASMModule> | null = null

function getModule(): Promise<QuickJSWASMModule> {
    if (!modulePromise) {
        modulePromise = newQuickJSWASMModuleFromVariant(variant)
    }
    return modulePromise
}

/** The `registry` shim injected into the sandbox (runs against `__CATALOG__`). */
const REGISTRY_SHIM = `
globalThis.registry = {
  listAll(filter) {
    let xs = globalThis.__CATALOG__;
    if (filter && filter.type) xs = xs.filter(e => e.type === filter.type);
    if (filter && filter.tag) xs = xs.filter(e => (e.tags || []).includes(filter.tag));
    return xs;
  },
  get(identifier) {
    return globalThis.__CATALOG__.find(e => e.identifier === identifier) || null;
  },
  search(query, opts) {
    const limit = (opts && opts.limit) || 10;
    const terms = String(query || '').toLowerCase().split(/\\s+/).filter(Boolean);
    if (!terms.length) return [];
    const scored = [];
    for (const e of globalThis.__CATALOG__) {
      const hay = [
        e.displayName, e.description,
        (e.tags || []).join(' '),
        (e.capabilities || []).join(' '),
        (e.representativeQueries || []).join(' ')
      ].join(' ').toLowerCase();
      let score = 0;
      for (const t of terms) if (hay.indexOf(t) !== -1) score++;
      if (score > 0) scored.push({ identifier: e.identifier, displayName: e.displayName, type: e.type, score: score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
};
`

export async function runSandbox(
    userCode: string,
    input: SandboxInput,
    options: SandboxOptions = {}
): Promise<SandboxResult> {
    const quickjs = await getModule()
    const runtime = quickjs.newRuntime()
    runtime.setMemoryLimit(options.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT)
    runtime.setMaxStackSize(MAX_STACK_SIZE)

    const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    let timedOut = false
    runtime.setInterruptHandler(() => {
        if (Date.now() > deadline) {
            timedOut = true
            return true
        }
        return false
    })

    const context = runtime.newContext()
    try {
        evalOrThrow(context, `globalThis.__CATALOG__ = ${JSON.stringify(input.catalog)};`)
        evalOrThrow(context, REGISTRY_SHIM)

        const wrapped = `(async () => {
            try {
                const __r = await (async () => { ${userCode} })();
                globalThis.__result__ = JSON.stringify(__r === undefined ? null : __r);
            } catch (e) {
                globalThis.__error__ = String(e && e.message ? e.message : e);
            }
        })();`

        const evalResult = context.evalCode(wrapped)
        if (evalResult.error) {
            const message = context.dump(evalResult.error)
            evalResult.error.dispose()
            return { ok: false, error: stringifyError(message) }
        }
        evalResult.value.dispose()

        // Drain the async IIFE's microtasks.
        for (;;) {
            const jobs = runtime.executePendingJobs()
            if (timedOut) {
                return { ok: false, error: 'Execution timed out.' }
            }
            if (jobs.error) {
                const message = context.dump(jobs.error)
                jobs.error.dispose()
                return { ok: false, error: stringifyError(message) }
            }
            if (jobs.value <= 0) {
                break
            }
        }

        const error = readGlobalString(context, '__error__')
        if (error !== null) {
            return { ok: false, error }
        }
        const resultJson = readGlobalString(context, '__result__')
        return { ok: true, value: resultJson === null ? null : JSON.parse(resultJson) }
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
        context.dispose()
        runtime.dispose()
    }
}

function evalOrThrow(context: ReturnType<QuickJSWASMModule['newContext']>, code: string): void {
    const result = context.evalCode(code)
    if (result.error) {
        const message = context.dump(result.error)
        result.error.dispose()
        throw new Error(stringifyError(message))
    }
    result.value.dispose()
}

function readGlobalString(
    context: ReturnType<QuickJSWASMModule['newContext']>,
    name: string
): string | null {
    const handle = context.getProp(context.global, name)
    const value = context.dump(handle)
    handle.dispose()
    return typeof value === 'string' ? value : null
}

function stringifyError(message: unknown): string {
    if (message && typeof message === 'object' && 'message' in message) {
        return String((message as { message: unknown }).message)
    }
    return String(message)
}
