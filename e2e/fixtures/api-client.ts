/**
 * Lightweight API helpers for E2E test fixtures.
 *
 * Uses raw fetch so there is no dependency on browser context — these helpers
 * can run in Playwright's Node.js setup scripts or inside `page.evaluate`.
 */

import { API_BASE_URL, TEST_PASSWORD } from './constants.js';

const ORIGIN = new URL(API_BASE_URL).origin;

interface AuthResult {
  sessionCookie: string;
  userId: string;
}

/**
 * Register a new user via Better-Auth and return the session cookie.
 */
export async function registerUser(username: string): Promise<AuthResult> {
  const res = await fetch(`${API_BASE_URL}/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({
      name: username,
      username,
      email: `${username}@e2e-test.local`,
      password: TEST_PASSWORD,
    }),
  });

  if (!res.ok) {
    throw new Error(`registerUser(${username}) failed: ${res.status} ${await res.text()}`);
  }

  const setCookie = res.headers.get('Set-Cookie') ?? '';
  const sessionCookie = setCookie.split(';')[0]; // "better-auth.session_token=..."
  const data = (await res.json()) as { user: { id: string } };

  return { sessionCookie, userId: data.user.id };
}

/**
 * Log in an existing user via Better-Auth.
 */
export async function loginUser(username: string): Promise<AuthResult> {
  const res = await fetch(`${API_BASE_URL}/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({
      email: `${username}@e2e-test.local`,
      password: TEST_PASSWORD,
    }),
  });

  if (!res.ok) {
    throw new Error(`loginUser(${username}) failed: ${res.status} ${await res.text()}`);
  }

  const setCookie = res.headers.get('Set-Cookie') ?? '';
  const sessionCookie = setCookie.split(';')[0];
  const data = (await res.json()) as { user: { id: string } };

  return { sessionCookie, userId: data.user.id };
}

/**
 * Return a fetch wrapper that injects the session cookie.
 */
export function authedFetch(sessionCookie: string) {
  return (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('Cookie', sessionCookie);
    return fetch(url, { ...init, headers });
  };
}
