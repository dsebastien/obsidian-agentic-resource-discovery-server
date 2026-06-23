import { join, normalize, sep } from 'node:path'

/**
 * Safely resolve a user-supplied relative path under a trusted root.
 *
 * Returns the absolute path if (and only if) it stays inside `rootDir`, else
 * `null`. Guards against `..` traversal, URL-encoded traversal, and null bytes.
 * Used by the skill file server so an agent can never read outside a configured
 * skill folder.
 */
export function safeJoin(rootDir: string, userRelPath: string): string | null {
    if (userRelPath.includes('\0')) {
        return null
    }
    let decoded: string
    try {
        decoded = decodeURIComponent(userRelPath)
    } catch {
        return null // malformed percent-encoding
    }
    if (decoded.includes('\0')) {
        return null
    }

    const root = normalize(rootDir)
    const requested = normalize(join(root, decoded))
    if (requested !== root && !requested.startsWith(root + sep)) {
        return null
    }
    return requested
}
