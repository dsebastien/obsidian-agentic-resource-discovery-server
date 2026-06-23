import { randomBytes } from 'node:crypto'

/**
 * Bearer token used to authenticate requests to the local registry server.
 *
 * Generated once on first run and stored in the plugin settings. 32 random
 * bytes → 64 hex characters → 256 bits of entropy.
 */
export const generateBearerToken = (): string => randomBytes(32).toString('hex')

/** Whether a stored token is missing/blank and therefore needs generating. */
export const isBlankToken = (token: string): boolean => token.trim().length === 0
