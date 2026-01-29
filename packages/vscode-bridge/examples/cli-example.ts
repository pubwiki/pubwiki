#!/usr/bin/env node

import { VfsBrowserClient } from '../src/index.js';
import { createVfs, VfsProvider, VfsStat } from '@pubwiki/vfs';
import { WebSocket } from 'ws';

// Polyfill WebSocket for Node.js environment
(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;

/**
 * In-memory VfsProvider with sample files
 */
class InMemoryProvider implements VfsProvider {
  private files = new Map<string, Uint8Array>();
  private dirs = new Set<string>(['/']);

  constructor() {
    this.initSampleFiles();
  }

  private initSampleFiles() {
    const encoder = new TextEncoder();
    
    this.files.set('/README.md', encoder.encode(
      '# My Virtual File System\n\nConnected to VS Code!\n'
    ));
    this.files.set('/.gitignore', encoder.encode('node_modules/\ndist/\n'));
    
    this.dirs.add('/src');
    this.files.set('/src/index.ts', encoder.encode(
      'console.log("Hello from VFS!");\n'
    ));
    this.files.set('/src/utils.ts', encoder.encode(
      'export const formatDate = (d: Date) => d.toISOString();\n'
    ));
    
    this.files.set('/package.json', encoder.encode(JSON.stringify({
      name: 'my-vfs-project',
      version: '1.0.0',
    }, null, 2)));

    console.log('✓ Initialized VFS with sample files');
  }

  async readFile(path: string): Promise<Uint8Array> {
    const content = this.files.get(path);
    if (!content) throw new Error(`ENOENT: ${path}`);
    console.log(`  Read: ${path}`);
    return content;
  }

  async writeFile(path: string, content: Uint8Array): Promise<void> {
    this.files.set(path, content);
    console.log(`  Write: ${path} (${content.length} bytes)`);
  }

  async unlink(path: string): Promise<void> {
    if (!this.files.delete(path)) throw new Error(`ENOENT: ${path}`);
    console.log(`  Delete: ${path}`);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (options?.recursive) {
      const parts = path.split('/').filter(Boolean);
      let current = '';
      for (const part of parts) {
        current += '/' + part;
        this.dirs.add(current);
      }
    } else {
      this.dirs.add(path);
    }
    console.log(`  Mkdir: ${path}`);
  }

  async readdir(path: string): Promise<string[]> {
    if (!this.dirs.has(path)) throw new Error(`ENOENT: ${path}`);
    const results: string[] = [];
    const prefix = path === '/' ? '/' : `${path}/`;

    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const relative = filePath.slice(prefix.length);
        if (!relative.includes('/')) results.push(relative);
      }
    }

    for (const dirPath of this.dirs) {
      if (dirPath !== path && dirPath.startsWith(prefix)) {
        const relative = dirPath.slice(prefix.length);
        if (!relative.includes('/')) results.push(relative);
      }
    }
    console.log(`  Readdir: ${path} (${results.length} entries)`);
    return results;
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (options?.recursive) {
      const prefix = path === '/' ? '/' : `${path}/`;
      for (const p of Array.from(this.files.keys())) {
        if (p.startsWith(prefix)) this.files.delete(p);
      }
      for (const p of Array.from(this.dirs)) {
        if (p.startsWith(prefix)) this.dirs.delete(p);
      }
    }
    this.dirs.delete(path);
    console.log(`  Rmdir: ${path}`);
  }

  async stat(path: string): Promise<VfsStat> {
    if (this.files.has(path)) {
      return {
        size: this.files.get(path)!.length,
        isFile: true,
        isDirectory: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
    if (this.dirs.has(path)) {
      return {
        size: 0,
        isFile: false,
        isDirectory: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
    throw new Error(`ENOENT: ${path}`);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async rename(from: string, to: string): Promise<void> {
    if (this.files.has(from)) {
      const content = this.files.get(from)!;
      this.files.delete(from);
      this.files.set(to, content);
    } else if (this.dirs.has(from)) {
      this.dirs.delete(from);
      this.dirs.add(to);
    } else {
      throw new Error(`ENOENT: ${from}`);
    }
    console.log(`  Rename: ${from} -> ${to}`);
  }

  async copyFile(from: string, to: string): Promise<void> {
    const content = this.files.get(from);
    if (!content) throw new Error(`ENOENT: ${from}`);
    this.files.set(to, content);
    console.log(`  Copy: ${from} -> ${to}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help') {
    console.log(`
Usage: tsx examples/cli-example.ts <callback-url>

Example:
  tsx examples/cli-example.ts "https://example.com?vscode_ws=ws://localhost:54321"
`);
    process.exit(0);
  }

  console.log('🚀 VFS Browser Client - @pubwiki/vfs Adapter\n');

  const provider = new InMemoryProvider();
  const vfs = createVfs(provider);
  await vfs.initialize();

  const client = new VfsBrowserClient(vfs);

  console.log('\n📋 Parsing callback URL...');
  let options;
  try {
    options = VfsBrowserClient.parseCallbackUrl(args[0]);
    console.log(`✓ WebSocket: ${options.websocketUrl}`);
  } catch (error) {
    console.error('✗ Invalid URL');
    process.exit(1);
  }

  console.log('\n🔌 Connecting...');
  try {
    await client.connect({ ...options, maxRetries: 10, retryDelay: 1000 });
    console.log('✓ Connected!\n');
    console.log('📁 Files available in VS Code');
    console.log('Press Ctrl+C to disconnect.\n');

    client.onDisconnect(() => console.log('\n⚠️  Disconnected'));
    client.onReconnect(() => console.log('✓ Reconnected'));

    process.on('SIGINT', () => {
      console.log('\n👋 Disconnecting...');
      client.disconnect();
      process.exit(0);
    });

    await new Promise(() => {});
  } catch (error) {
    console.error('✗ Connection failed');
    process.exit(1);
  }
}

main().catch(console.error);

export { InMemoryProvider };
