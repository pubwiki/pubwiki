/**
 * Shared constants for E2E tests.
 *
 * Local dev servers use HTTPS with self-signed certs.
 * CI starts fresh HTTP servers. Override with E2E_* env vars if needed.
 */

const CI = !!process.env.CI;
const protocol = CI ? 'http' : 'https';

export const API_BASE_URL = process.env.E2E_API_BASE_URL ?? `${protocol}://localhost:8787/api`;
export const HUB_URL = process.env.E2E_HUB_URL ?? `${protocol}://localhost:5173`;
export const STUDIO_URL = process.env.E2E_STUDIO_URL ?? `${protocol}://localhost:5174`;

/** Default password for all test users */
export const TEST_PASSWORD = 'TestPassword123!';

/** Storage state path for the authenticated user */
export const AUTH_STATE_PATH = '.auth/user.json';
