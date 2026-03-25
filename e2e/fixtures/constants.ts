/**
 * Shared constants for E2E tests.
 *
 * Ports are allocated dynamically by globalSetup and written to
 * .e2e-ports.json + E2E_* env vars. This module reads them lazily
 * on first access (after globalSetup has run). If neither source is
 * available, the access throws immediately rather than silently
 * hitting dev servers.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { E2EPorts } from './global-setup.js';

const PORTS_FILE = path.join(import.meta.dirname, '../.e2e-ports.json');

let _ports: E2EPorts | null | undefined; // undefined = not yet loaded

function getPorts(): E2EPorts | null {
  if (_ports !== undefined) return _ports;
  try {
    _ports = JSON.parse(fs.readFileSync(PORTS_FILE, 'utf-8')) as E2EPorts;
  } catch {
    _ports = null;
  }
  return _ports as E2EPorts | null;
}

function requireUrl(envKey: string, buildFromPorts: (ports: E2EPorts) => string): string {
  const envValue = process.env[envKey];
  if (envValue) return envValue;

  const ports = getPorts();
  if (ports) return buildFromPorts(ports);

  throw new Error(
    `E2E URL not available: ${envKey} env var is not set and .e2e-ports.json is missing or invalid. ` +
    `Ensure globalSetup ran successfully.`
  );
}

function getProtocol(): string {
  return getPorts()?.protocol ?? 'https';
}

export function getApiBaseUrl(): string {
  return requireUrl('E2E_API_BASE_URL', (p) => `${getProtocol()}://localhost:${p.backendPort}/api`);
}

export function getHubUrl(): string {
  return requireUrl('E2E_HUB_URL', (p) => `${getProtocol()}://localhost:${p.hubPort}`);
}

export function getStudioUrl(): string {
  return requireUrl('E2E_STUDIO_URL', (p) => `${getProtocol()}://localhost:${p.studioPort}`);
}

export function getPlayerUrl(): string {
  return requireUrl('E2E_PLAYER_URL', (p) => `${getProtocol()}://localhost:${p.playerPort}`);
}

export function getSandboxUrl(): string {
  return requireUrl('E2E_SANDBOX_URL', (p) => `${getProtocol()}://localhost:${p.sandboxPort}`);
}

/** Default password for all test users */
export const TEST_PASSWORD = 'TestPassword123!';

/** Storage state path for the authenticated user */
export const AUTH_STATE_PATH = '.auth/user.json';
