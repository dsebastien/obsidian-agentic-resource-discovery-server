import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from 'quickjs-emscripten-core'
import variant from '@jitl/quickjs-singlefile-cjs-release-sync'
import { LEXICAL_CONFIG_JSON, REGISTRY_SHIM } from './registry-shim'
import { miniSearchUmdSource } from './minisearch-source' with { type: 'macro' }

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

/**
 * MiniSearch's own source, inlined at bundle time by the macro. Injected as a
 * string and only evaluated when in-sandbox code actually searches.
 */
const MINISEARCH_SOURCE: string = miniSearchUmdSource()

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
        evalOrThrow(context, `globalThis.__LEXICAL_CONFIG__ = ${LEXICAL_CONFIG_JSON};`)
        evalOrThrow(
            context,
            `globalThis.__MINISEARCH_SRC__ = ${JSON.stringify(MINISEARCH_SOURCE)};`
        )
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
