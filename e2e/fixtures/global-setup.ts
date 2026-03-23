/**
 * Playwright globalSetup — starts backend + frontend dev servers on
 * dynamically allocated ports with a fresh database every run.
 *
 * 1. Allocates three free ports (backend, hub, studio)
 * 2. Creates a temp directory for D1 persistence (clean DB)
 * 3. Runs wrangler d1 migrations
 * 4. Spawns all three dev servers
 * 5. Waits for each to become healthy
 * 6. Writes port info to .e2e-ports.json so tests can discover them
 * 7. Returns a teardown function that kills processes and cleans up
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import getPort from 'get-port';

const CI = !!process.env.CI;
const protocol = CI ? 'http' : 'https';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const SERVICES_HUB = path.join(WORKSPACE_ROOT, 'services/hub');

/** Path to the file where port info is persisted for test processes */
export const PORTS_FILE = path.join(import.meta.dirname, '../.e2e-ports.json');

export interface E2EPorts {
  backendPort: number;
  hubPort: number;
  studioPort: number;
  playerPort: number;
  sandboxPort: number;
  protocol: string;
  persistDir: string;
}

/** Timeout for each server health check (ms) */
const HEALTH_TIMEOUT = 90_000;
const HEALTH_INTERVAL = 1_000;

// Accept self-signed certs during health checks
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function waitForServer(url: string, label: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < HEALTH_TIMEOUT) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (res.ok || res.status === 404) {
        console.log(`  ✓ ${label} ready at ${url}`);
        return;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, HEALTH_INTERVAL));
  }
  throw new Error(`${label} did not start within ${HEALTH_TIMEOUT}ms at ${url}`);
}

function spawnServer(
  cmd: string,
  args: string[],
  opts: { cwd: string; env?: Record<string, string>; label: string },
): ChildProcess {
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    detached: true, // Create process group so we can kill the entire tree
  });

  const prefix = `[${opts.label}] `;
  child.stdout?.on('data', (d: Buffer) => {
    for (const line of d.toString().split('\n').filter(Boolean)) {
      console.log(prefix + line);
    }
  });
  child.stderr?.on('data', (d: Buffer) => {
    for (const line of d.toString().split('\n').filter(Boolean)) {
      console.error(prefix + line);
    }
  });

  return child;
}

function killTree(child: ChildProcess): void {
  if (child.pid) {
    try {
      // Kill the entire process group (shell + children)
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
    }
  }
}

export default async function globalSetup() {
  console.log('\n🔧 E2E Global Setup\n');

  // 1. Allocate dynamic ports
  const backendPort = await getPort();
  const hubPort = await getPort();
  const studioPort = await getPort();
  const playerPort = await getPort();
  const sandboxPort = await getPort();
  console.log(`  Ports: backend=${backendPort}, hub=${hubPort}, studio=${studioPort}, player=${playerPort}, sandbox=${sandboxPort}`);

  // 2. Create temp directory for fresh D1 persistence
  const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-d1-'));
  console.log(`  DB persist dir: ${persistDir}`);

  // 3. Run migrations against the fresh DB (stdin from /dev/null → non-interactive → skips confirmation)
  console.log('  Running D1 migrations...');
  execSync(
    `npx wrangler d1 migrations apply DB --local --persist-to ${persistDir} --config wrangler.test.jsonc`,
    { cwd: SERVICES_HUB, stdio: ['ignore', 'inherit', 'inherit'] },
  );

  // 4. Write port info so test processes (constants.ts) can read it
  const ports: E2EPorts = { backendPort, hubPort, studioPort, playerPort, sandboxPort, protocol, persistDir };
  fs.writeFileSync(PORTS_FILE, JSON.stringify(ports, null, 2));

  // 5. Set env vars for the Playwright runner process (read by constants.ts)
  process.env.E2E_API_BASE_URL = `${protocol}://localhost:${backendPort}/api`;
  process.env.E2E_HUB_URL = `${protocol}://localhost:${hubPort}`;
  process.env.E2E_STUDIO_URL = `${protocol}://localhost:${studioPort}`;
  process.env.E2E_PLAYER_URL = `${protocol}://localhost:${playerPort}`;

  // 5.5 Build sandbox (uses preview mode to avoid Vite dev server 503 issues)
  console.log('  Building sandbox...');
  execSync('pnpm build', {
    cwd: path.join(WORKSPACE_ROOT, 'apps/sandbox'),
    env: {
      ...process.env,
      VITE_MAIN_ORIGIN: `${protocol}://localhost:${playerPort},${protocol}://localhost:${studioPort}`,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  // 6. Start backend (wrangler dev)
  const backendArgs = [
    'wrangler', 'dev',
    '--port', String(backendPort),
    '--config', 'wrangler.test.jsonc',
    '--persist-to', persistDir,
    '--var', `BETTER_AUTH_URL:${protocol}://localhost:${backendPort}`,
  ];
  if (!CI) {
    backendArgs.push(
      '--local-protocol', 'https',
      '--https-cert-path', 'cert.pem',
      '--https-key-path', 'key.pem',
    );
  }
  console.log('  Starting backend...');
  const backendChild = spawnServer('npx', backendArgs, {
    cwd: SERVICES_HUB,
    label: 'backend',
  });

  // 7. Start Hub frontend
  console.log('  Starting Hub frontend...');
  const hubChild = spawnServer(
    'npx', ['vite', 'dev', '--port', String(hubPort)],
    {
      cwd: path.join(WORKSPACE_ROOT, 'apps/hub'),
      env: {
        PUBLIC_API_BASE_URL: `${protocol}://localhost:${backendPort}/api`,
        PUBLIC_PLAY_URL: `${protocol}://localhost:${playerPort}`,
      },
      label: 'hub',
    },
  );

  // 8. Start Studio frontend
  console.log('  Starting Studio frontend...');
  const studioChild = spawnServer(
    'npx', ['vite', 'dev', '--port', String(studioPort)],
    {
      cwd: path.join(WORKSPACE_ROOT, 'apps/studio'),
      env: {
        PUBLIC_API_BASE_URL: `${protocol}://localhost:${backendPort}/api`,
        PUBLIC_SANDBOX_SITE_URL: `${protocol}://localhost:${sandboxPort}`,
      },
      label: 'studio',
    },
  );

  // 9. Start Player frontend
  console.log('  Starting Player frontend...');
  const playerChild = spawnServer(
    'npx', ['vite', 'dev', '--port', String(playerPort)],
    {
      cwd: path.join(WORKSPACE_ROOT, 'apps/player'),
      env: {
        PUBLIC_API_BASE_URL: `${protocol}://localhost:${backendPort}/api`,
        PUBLIC_SANDBOX_SITE_URL: `${protocol}://localhost:${sandboxPort}`,
      },
      label: 'player',
    },
  );

  // 10. Start Sandbox server (preview mode — serves pre-built static files)
  console.log('  Starting Sandbox server (preview)...');
  const sandboxChild = spawnServer(
    'npx', ['vite', 'preview', '--port', String(sandboxPort)],
    {
      cwd: path.join(WORKSPACE_ROOT, 'apps/sandbox'),
      label: 'sandbox',
    },
  );

  const children = [backendChild, hubChild, studioChild, playerChild, sandboxChild];

  // Ensure children are killed if the setup itself crashes
  const cleanup = () => {
    for (const child of children) killTree(child);
  };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);

  // 9. Wait for all servers to be healthy
  console.log('  Waiting for servers...');
  try {
    await Promise.all([
      waitForServer(`${protocol}://localhost:${backendPort}/api/`, 'Backend'),
      waitForServer(`${protocol}://localhost:${hubPort}`, 'Hub'),
      waitForServer(`${protocol}://localhost:${studioPort}`, 'Studio'),
      waitForServer(`${protocol}://localhost:${playerPort}`, 'Player'),
      waitForServer(`${protocol}://localhost:${sandboxPort}`, 'Sandbox'),
    ]);
  } catch (err) {
    cleanup();
    throw err;
  }

  console.log('\n✅ All servers ready\n');

  // Return teardown function — Playwright calls this after all tests finish
  return async () => {
    console.log('\n🧹 E2E Teardown\n');

    // Kill all server processes
    for (const child of children) killTree(child);

    // Clean up temp DB directory
    try {
      fs.rmSync(persistDir, { recursive: true, force: true });
      console.log(`  Removed temp DB dir: ${persistDir}`);
    } catch { /* best effort */ }

    // Clean up ports file
    try { fs.unlinkSync(PORTS_FILE); } catch { /* best effort */ }

    console.log('  Done\n');
  };
}
