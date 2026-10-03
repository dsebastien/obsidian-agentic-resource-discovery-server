import { randomBytes } from 'node:crypto'

/**
 * Bearer token used to authenticate requests to the local registry server.
 *
 * Generated once on first run and stored in Obsidian's SecretStorage (never
 * in the plugin settings). 32 random
 * bytes → 64 hex characters → 256 bits of entropy.
 */
export const generateBearerToken = (): string => randomBytes(32).toString('hex')
