/**
 * Sandbox ID computation and origin resolution
 *
 * Each (artifactId, entrypoint) pair gets a unique, DNS-safe subdomain
 * for storage isolation via the browser's same-origin policy.
 */

/**
 * Compute a stable, DNS-safe sandbox ID from (artifactId, entrypoint).
 * Uses SHA-256 truncated to 12 hex chars (~48 bits, collision-safe for practical scale).
 *
 * @param artifactId - The artifact UUID
 * @param entrypoint - The entry file path (e.g. 'index.html')
 * @returns 12-character hex string suitable as a subdomain label
 */
export async function computeSandboxId(artifactId: string, entrypoint: string): Promise<string> {
  const input = `${artifactId}\0${entrypoint}`
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  return hex.slice(0, 12)
}

/**
 * Resolve the sandbox origin URL for a given sandbox ID.
 *
 * If `siteUrlTemplate` is provided (e.g. from `PUBLIC_SANDBOX_SITE_URL` env var),
 * replaces `{id}` placeholder with the sandbox ID.
 * Otherwise, defaults to `https://{sandboxId}.soyo.mu`.
 *
 * @param sandboxId - The computed sandbox ID (12-char hex)
 * @param siteUrlTemplate - Optional URL template with `{id}` placeholder
 * @returns Full origin URL (e.g. `https://a3f8b2c1d4e5.soyo.mu`)
 */
export function getSandboxOrigin(sandboxId: string, siteUrlTemplate?: string): string {
  if (siteUrlTemplate) {
    return siteUrlTemplate.replace('{id}', sandboxId)
  }
  return `https://${sandboxId}.soyo.mu`
}
