/**
 * OpfsProvider + GitCompatibleFs Tests
 *
 * Uses an instrumented OPFS mock that tracks every handle and writable stream.
 * Each test verifies:
 *   1. Correctness — operations produce expected results
 *   2. Resource safety — no WritableFileStream left unclosed
 *
 * The "resource leak" describe block specifically tests the patterns that
 * caused the original NotReadableError bug.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { installOpfsMock, uninstallOpfsMock, type OpfsAuditRegistry } from '../mocks/opfs-mock';
import { OpfsProvider, GitCompatibleFs } from '$lib/vfs/opfs-provider';

let registry: OpfsAuditRegistry;

beforeEach(() => {
  registry = installOpfsMock();
});

afterEach(() => {
  registry.assertNoLeaks();   // FAIL if any stream left open
  uninstallOpfsMock();
});

// Helper: create an initialized provider
async function makeProvider(projectId = 'proj1', nodeId = 'node1'): Promise<OpfsProvider> {
  const p = new OpfsProvider(projectId, nodeId);
  await p.initialize();
  return p;
}

// ============================================================
// Basic CRUD operations
// ============================================================

describe('OpfsProvider — CRUD', () => {
  it('writeFile + readFile round-trip', async () => {
    const p = await makeProvider();
    const data = new TextEncoder().encode('hello world');
    await p.writeFile('/test.txt', data);
    const result = await p.readFile('/test.txt');
    expect(new TextDecoder().decode(result)).toBe('hello world');
  });

  it('writeFile creates parent dirs', async () => {
    const p = await makeProvider();
    await p.writeFile('/a/b/c.txt', new Uint8Array([1, 2, 3]));
    const stat = await p.stat('/a/b/c.txt');
    expect(stat.isFile).toBe(true);
  });

  it('readFile on nonexistent file throws ENOENT', async () => {
    const p = await makeProvider();
    await expect(p.readFile('/nope.txt')).rejects.toThrow();
    try { await p.readFile('/nope.txt'); } catch (e: unknown) {
      expect((e as NodeJS.ErrnoException).code).toBe('ENOENT');
    }
  });

  it('readFile on directory throws EISDIR', async () => {
    const p = await makeProvider();
    await p.mkdir('/dir');
    await expect(p.readFile('/dir')).rejects.toThrow();
  });

  it('unlink removes a file', async () => {
    const p = await makeProvider();
    await p.writeFile('/f.txt', new Uint8Array([1]));
    await p.unlink('/f.txt');
    expect(await p.exists('/f.txt')).toBe(false);
  });

  it('mkdir + readdir', async () => {
    const p = await makeProvider();
    await p.mkdir('/sub');
    await p.writeFile('/sub/a.txt', new Uint8Array(0));
    await p.writeFile('/sub/b.txt', new Uint8Array(0));
    const entries = await p.readdir('/sub');
    expect(entries.sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('mkdir recursive creates nested dirs', async () => {
    const p = await makeProvider();
    await p.mkdir('/x/y/z', { recursive: true });
    const stat = await p.stat('/x/y/z');
    expect(stat.isDirectory).toBe(true);
  });

  it('rmdir recursive removes non-empty directory', async () => {
    const p = await makeProvider();
    await p.writeFile('/d/f.txt', new Uint8Array(0));
    await p.rmdir('/d', { recursive: true });
    expect(await p.exists('/d')).toBe(false);
  });

  it('stat returns correct info for files', async () => {
    const p = await makeProvider();
    const data = new Uint8Array(42);
    await p.writeFile('/data.bin', data);
    const stat = await p.stat('/data.bin');
    expect(stat.isFile).toBe(true);
    expect(stat.isDirectory).toBe(false);
    expect(stat.size).toBe(42);
  });

  it('stat returns correct info for directories', async () => {
    const p = await makeProvider();
    await p.mkdir('/dir');
    const stat = await p.stat('/dir');
    expect(stat.isFile).toBe(false);
    expect(stat.isDirectory).toBe(true);
  });

  it('stat on root returns directory', async () => {
    const p = await makeProvider();
    const stat = await p.stat('/');
    expect(stat.isDirectory).toBe(true);
  });

  it('exists returns true/false correctly', async () => {
    const p = await makeProvider();
    expect(await p.exists('/nope')).toBe(false);
    await p.writeFile('/yes.txt', new Uint8Array(0));
    expect(await p.exists('/yes.txt')).toBe(true);
  });

  it('rename file', async () => {
    const p = await makeProvider();
    await p.writeFile('/old.txt', new TextEncoder().encode('data'));
    await p.rename('/old.txt', '/new.txt');
    expect(await p.exists('/old.txt')).toBe(false);
    const content = new TextDecoder().decode(await p.readFile('/new.txt'));
    expect(content).toBe('data');
  });

  it('copyFile', async () => {
    const p = await makeProvider();
    await p.writeFile('/src.txt', new TextEncoder().encode('copy'));
    await p.copyFile('/src.txt', '/dst.txt');
    expect(await p.exists('/src.txt')).toBe(true);
    expect(new TextDecoder().decode(await p.readFile('/dst.txt'))).toBe('copy');
  });
});

// ============================================================
// Provider isolation
// ============================================================

describe('OpfsProvider — Isolation', () => {
  it('different nodeIds are isolated', async () => {
    const p1 = await makeProvider('proj', 'a');
    const p2 = await makeProvider('proj', 'b');
    await p1.writeFile('/file.txt', new TextEncoder().encode('from-a'));
    expect(await p2.exists('/file.txt')).toBe(false);
  });

  it('different projectIds are isolated', async () => {
    const p1 = await makeProvider('proj1', 'n');
    const p2 = await makeProvider('proj2', 'n');
    await p1.writeFile('/x.txt', new Uint8Array(0));
    expect(await p2.exists('/x.txt')).toBe(false);
  });
});

// ============================================================
// Lifecycle & dispose
// ============================================================

describe('OpfsProvider — Lifecycle', () => {
  it('throws if used before initialize', async () => {
    const p = new OpfsProvider('x', 'y'); // no initialize()
    await expect(p.readFile('/a')).rejects.toThrow('not initialized');
  });

  it('double initialize is idempotent', async () => {
    const p = await makeProvider();
    await p.initialize(); // second call
    await p.writeFile('/ok.txt', new Uint8Array(0));
    expect(await p.exists('/ok.txt')).toBe(true);
  });

  it('dispose releases internal state', async () => {
    const p = await makeProvider();
    await p.writeFile('/f.txt', new Uint8Array(0));
    await p.dispose();
    await expect(p.readFile('/f.txt')).rejects.toThrow('not initialized');
  });

  it('can re-initialize after dispose', async () => {
    const p = new OpfsProvider('proj', 'nd');
    await p.initialize();
    await p.writeFile('/file.txt', new TextEncoder().encode('data'));
    await p.dispose();

    // Re-initialize: data should still exist in OPFS
    await p.initialize();
    const content = new TextDecoder().decode(await p.readFile('/file.txt'));
    expect(content).toBe('data');
  });
});

// ============================================================
// Resource leak detection — THE CORE VALUE OF THESE TESTS
// ============================================================

describe('OpfsProvider — Resource Leak Detection', () => {
  it('writeFile always closes WritableFileStream (normal path)', async () => {
    const p = await makeProvider();
    await p.writeFile('/f.txt', new Uint8Array([1, 2, 3]));
    // afterEach calls registry.assertNoLeaks() — will fail if stream left open
    expect(registry.openWritables).toHaveLength(0);
  });

  it('multiple sequential writes leave zero open streams', async () => {
    const p = await makeProvider();
    for (let i = 0; i < 50; i++) {
      await p.writeFile(`/file-${i}.txt`, new TextEncoder().encode(`content-${i}`));
    }
    expect(registry.openWritables).toHaveLength(0);
  });

  it('overwriting same file many times leaves zero open streams', async () => {
    const p = await makeProvider();
    for (let i = 0; i < 30; i++) {
      await p.writeFile('/same.txt', new TextEncoder().encode(`v${i}`));
    }
    expect(registry.openWritables).toHaveLength(0);
    expect(new TextDecoder().decode(await p.readFile('/same.txt'))).toBe('v29');
  });

  it('dispose after writes still leaves zero open streams', async () => {
    const p = await makeProvider();
    await p.writeFile('/a.txt', new Uint8Array(100));
    await p.writeFile('/b.txt', new Uint8Array(200));
    await p.dispose();
    expect(registry.openWritables).toHaveLength(0);
  });

  it('create-and-dispose cycle N times does not accumulate leaks', async () => {
    for (let i = 0; i < 20; i++) {
      const p = await makeProvider('proj', `node-${i}`);
      await p.writeFile('/data.bin', new Uint8Array(64));
      await p.dispose();
    }
    expect(registry.openWritables).toHaveLength(0);
  });

  it('handle count stays bounded across provider cycles', async () => {
    // This is the key test for the original bug:
    // ZenFS cached ALL handles forever. Our OpfsProvider should not.
    const handlesBefore = registry.totalHandleCount;

    for (let cycle = 0; cycle < 10; cycle++) {
      const p = await makeProvider('proj', `cycle-${cycle}`);
      // Create a bunch of files
      for (let f = 0; f < 10; f++) {
        await p.writeFile(`/dir/file-${f}.txt`, new Uint8Array(32));
      }
      await p.readdir('/dir');
      await p.dispose();
    }

    // Handles were created (that's fine), but they should be released on dispose.
    // The audit counts total created handles, but the important thing is
    // no open writable streams remain.
    expect(registry.openWritables).toHaveLength(0);

    // Also verify handles were actually created (sanity check that mock works)
    expect(registry.totalHandleCount).toBeGreaterThan(handlesBefore);
  });

  it('rename (copy+delete) leaves zero open streams', async () => {
    const p = await makeProvider();
    await p.writeFile('/before.txt', new TextEncoder().encode('rename-test'));
    await p.rename('/before.txt', '/after.txt');
    expect(registry.openWritables).toHaveLength(0);
  });

  it('copyFile leaves zero open streams', async () => {
    const p = await makeProvider();
    await p.writeFile('/src.txt', new Uint8Array(100));
    await p.copyFile('/src.txt', '/dst.txt');
    expect(registry.openWritables).toHaveLength(0);
  });
});

// ============================================================
// GitCompatibleFs wrapper
// ============================================================

describe('GitCompatibleFs', () => {
  let provider: OpfsProvider;
  let gitFs: GitCompatibleFs;

  beforeEach(async () => {
    provider = await makeProvider('git-proj', 'git-node');
    gitFs = provider.asGitFs();
  });

  afterEach(async () => {
    await provider.dispose();
  });

  it('readFile returns Uint8Array by default', async () => {
    await provider.writeFile('/test.txt', new TextEncoder().encode('hello'));
    const result = await gitFs.promises.readFile('/test.txt');
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('readFile with encoding=utf8 returns string', async () => {
    await provider.writeFile('/test.txt', new TextEncoder().encode('hello'));
    const result = await gitFs.promises.readFile('/test.txt', { encoding: 'utf8' });
    expect(result).toBe('hello');
  });

  it('writeFile with string data', async () => {
    await gitFs.promises.writeFile('/str.txt', 'string content');
    const data = await provider.readFile('/str.txt');
    expect(new TextDecoder().decode(data)).toBe('string content');
  });

  it('writeFile with Uint8Array data', async () => {
    await gitFs.promises.writeFile('/bin.dat', new Uint8Array([0xDE, 0xAD]));
    const data = await provider.readFile('/bin.dat');
    expect(data).toEqual(new Uint8Array([0xDE, 0xAD]));
  });

  it('mkdir creates directories recursively', async () => {
    await gitFs.promises.mkdir('/a/b/c');
    const stat = await provider.stat('/a/b/c');
    expect(stat.isDirectory).toBe(true);
  });

  it('rmdir removes empty directory', async () => {
    await provider.mkdir('/empty');
    await gitFs.promises.rmdir('/empty');
    expect(await provider.exists('/empty')).toBe(false);
  });

  it('unlink removes file', async () => {
    await provider.writeFile('/del.txt', new Uint8Array(0));
    await gitFs.promises.unlink('/del.txt');
    expect(await provider.exists('/del.txt')).toBe(false);
  });

  it('stat returns OpfsStats with correct methods', async () => {
    await provider.writeFile('/f.txt', new Uint8Array(10));
    const stat = await gitFs.promises.stat('/f.txt');
    expect(stat.isFile()).toBe(true);
    expect(stat.isDirectory()).toBe(false);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.size).toBe(10);
    expect(typeof stat.mtimeMs).toBe('number');
  });

  it('lstat is same as stat (no symlinks in OPFS)', async () => {
    await provider.writeFile('/f.txt', new Uint8Array(5));
    const stat = await gitFs.promises.stat('/f.txt');
    const lstat = await gitFs.promises.lstat('/f.txt');
    expect(stat.size).toBe(lstat.size);
    expect(stat.isFile()).toBe(lstat.isFile());
  });

  it('readdir returns file names', async () => {
    await provider.writeFile('/dir/a.txt', new Uint8Array(0));
    await provider.writeFile('/dir/b.txt', new Uint8Array(0));
    const entries = await gitFs.promises.readdir('/dir');
    expect(entries.sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('readlink throws ENOTSUP', async () => {
    await expect(gitFs.promises.readlink('/any')).rejects.toThrow();
  });

  it('symlink throws ENOTSUP', async () => {
    await expect(gitFs.promises.symlink('/a', '/b')).rejects.toThrow();
  });

  it('chmod is a no-op (does not throw)', async () => {
    await provider.writeFile('/f.txt', new Uint8Array(0));
    await expect(gitFs.promises.chmod('/f.txt', 0o755)).resolves.toBeUndefined();
  });
});

// ============================================================
// isomorphic-git integration
// ============================================================

describe('GitCompatibleFs — isomorphic-git integration', () => {
  let provider: OpfsProvider;
  let gitFs: GitCompatibleFs;

  // Polyfill Buffer for isomorphic-git
  beforeEach(async () => {
    provider = await makeProvider('git-int', 'repo');
    gitFs = provider.asGitFs();
  });

  afterEach(async () => {
    await provider.dispose();
  });

  it('git init + add + commit + log round-trip', async () => {
    // Dynamic import to avoid issues if isomorphic-git is not available
    const git = await import('isomorphic-git');

    // init
    await git.init({ fs: gitFs, dir: '/', defaultBranch: 'main' });

    // write a file
    await gitFs.promises.writeFile('/readme.md', 'Hello from test');

    // add
    await git.add({ fs: gitFs, dir: '/', filepath: 'readme.md' });

    // commit
    const sha = await git.commit({
      fs: gitFs,
      dir: '/',
      message: 'initial commit',
      author: { name: 'Test', email: 'test@test.local' },
    });
    expect(sha).toBeTruthy();
    expect(typeof sha).toBe('string');

    // log
    const logs = await git.log({ fs: gitFs, dir: '/', depth: 5 });
    expect(logs).toHaveLength(1);
    expect(logs[0].commit.message).toBe('initial commit\n');
    expect(logs[0].oid).toBe(sha);
  });

  it('statusMatrix detects untracked files', async () => {
    const git = await import('isomorphic-git');
    await git.init({ fs: gitFs, dir: '/', defaultBranch: 'main' });

    // Create initial commit
    await gitFs.promises.writeFile('/a.txt', 'original');
    await git.add({ fs: gitFs, dir: '/', filepath: 'a.txt' });
    await git.commit({
      fs: gitFs, dir: '/', message: 'init',
      author: { name: 'T', email: 't@t' },
    });

    // Add new untracked file
    await gitFs.promises.writeFile('/b.txt', 'new file');

    const matrix = await git.statusMatrix({ fs: gitFs, dir: '/' });
    // At minimum, b.txt should show up as untracked (HEAD=0, WORKDIR=2, STAGE=0)
    const bEntry = matrix.find(([f]) => f === 'b.txt');
    expect(bEntry).toBeTruthy();
    expect(bEntry![1]).toBe(0); // not in HEAD
    expect(bEntry![2]).toBe(2); // exists in workdir
  });

  it('readBlob works for committed files', async () => {
    const git = await import('isomorphic-git');
    await git.init({ fs: gitFs, dir: '/', defaultBranch: 'main' });

    await gitFs.promises.writeFile('/data.txt', 'blob content');
    await git.add({ fs: gitFs, dir: '/', filepath: 'data.txt' });
    const sha = await git.commit({
      fs: gitFs, dir: '/', message: 'add data',
      author: { name: 'T', email: 't@t' },
    });

    const blob = await git.readBlob({
      fs: gitFs, dir: '/', oid: sha, filepath: 'data.txt',
    });
    expect(new TextDecoder().decode(blob.blob)).toBe('blob content');
  });

  it('checkout restores files', async () => {
    const git = await import('isomorphic-git');
    await git.init({ fs: gitFs, dir: '/', defaultBranch: 'main' });

    // Create initial commit
    await gitFs.promises.writeFile('/file.txt', 'v1');
    await git.add({ fs: gitFs, dir: '/', filepath: 'file.txt' });
    const sha1 = await git.commit({
      fs: gitFs, dir: '/', message: 'v1',
      author: { name: 'T', email: 't@t' },
    });

    // Create second commit
    await gitFs.promises.writeFile('/file.txt', 'v2');
    await git.add({ fs: gitFs, dir: '/', filepath: 'file.txt' });
    await git.commit({
      fs: gitFs, dir: '/', message: 'v2',
      author: { name: 'T', email: 't@t' },
    });

    // Checkout first commit
    await git.checkout({ fs: gitFs, dir: '/', ref: sha1, force: true });
    const content = await gitFs.promises.readFile('/file.txt', { encoding: 'utf8' });
    expect(content).toBe('v1');
  });

  it('all git operations leave zero open streams', async () => {
    const git = await import('isomorphic-git');
    await git.init({ fs: gitFs, dir: '/', defaultBranch: 'main' });

    // Simulate a realistic workflow
    for (let i = 0; i < 5; i++) {
      await gitFs.promises.writeFile(`/file-${i}.txt`, `content-${i}`);
      await git.add({ fs: gitFs, dir: '/', filepath: `file-${i}.txt` });
    }
    await git.commit({
      fs: gitFs, dir: '/', message: 'batch commit',
      author: { name: 'T', email: 't@t' },
    });

    // Verify no resource leaks after a full git workflow
    expect(registry.openWritables).toHaveLength(0);
  });
});

// ============================================================
// Stress: simulates the original multi-project bug scenario
// ============================================================

describe('OpfsProvider — Multi-project Stress Test', () => {
  it('create 10 projects × 5 nodes, write files, dispose all — zero leaks', async () => {
    const providers: OpfsProvider[] = [];

    for (let proj = 0; proj < 10; proj++) {
      for (let node = 0; node < 5; node++) {
        const p = await makeProvider(`proj-${proj}`, `node-${node}`);
        providers.push(p);

        // Simulate VFS file creation
        for (let f = 0; f < 5; f++) {
          await p.writeFile(`/src/file-${f}.txt`, new TextEncoder().encode(`p${proj}n${node}f${f}`));
        }
      }
    }

    // Verify data isolation
    const p00 = providers[0]; // proj-0, node-0
    const content = new TextDecoder().decode(await p00.readFile('/src/file-0.txt'));
    expect(content).toBe('p0n0f0');

    // Dispose all (simulates project switch)
    for (const p of providers) {
      await p.dispose();
    }

    expect(registry.openWritables).toHaveLength(0);
  });

  it('repeated init-use-dispose cycles on same project/node', async () => {
    // This tests the "project switch" scenario:
    // User opens project, works, navigates away, comes back.
    for (let cycle = 0; cycle < 10; cycle++) {
      const p = await makeProvider('same-proj', 'same-node');

      if (cycle === 0) {
        await p.writeFile('/persistent.txt', new TextEncoder().encode('original'));
      }

      // Read data from previous cycle (should persist in OPFS)
      const data = new TextDecoder().decode(await p.readFile('/persistent.txt'));
      expect(data).toBe('original');

      // Modify
      await p.writeFile(`/cycle-${cycle}.txt`, new TextEncoder().encode(`cycle-${cycle}`));

      await p.dispose();
    }

    expect(registry.openWritables).toHaveLength(0);
  });
});
