import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Bun macro: inlines MiniSearch's UMD build as a string at bundle time.
 *
 * The Code Mode sandbox has no module loader and no host bridge, so the only way
 * for `registry.search` to rank exactly like the lexical backend is to evaluate
 * the very same library inside the isolate. Importing this with
 * `with { type: 'macro' }` turns the call into a string literal in `main.js`, so
 * nothing reads the filesystem at runtime.
 */
export function miniSearchUmdSource(): string {
    return readFileSync(
        join(import.meta.dir, '../../../node_modules/minisearch/dist/umd/index.js'),
        'utf-8'
    )
}
