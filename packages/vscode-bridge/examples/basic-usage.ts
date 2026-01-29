import { VfsBrowserClient } from '../src/index.js';
import { createVfs, VfsProvider, VfsStat } from '@pubwiki/vfs';

/**
 * Example: In-memory VfsProvider implementation for @pubwiki/vfs
 */
class InMemoryProvider implements VfsProvider {
  private files = new Map<string, Uint8Array>();
  private dirs = new Set<string>(['/']);

  async readFile(path: string): Promise<Uint8Array> {
    const content = this.files.get(path);
    if (!content) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return content;
  }

  async writeFile(path: string, content: Uint8Array): Promise<void> {
    this.files.set(path, content);
  }

  async unlink(path: string): Promise<void> {
    if (!this.files.delete(path)) {
      throw new Error(`ENOENT: no such file or directory, unlink '${path}'`);
    }
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
  }

  async readdir(path: string): Promise<string[]> {
    if (!this.dirs.has(path)) {
      throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
    }
    const results: string[] = [];
    const prefix = path === '/' ? '/' : `${path}/`;

    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const relative = filePath.slice(prefix.length);
        if (!relative.includes('/')) {
          results.push(relative);
        }
      }
    }

    for (const dirPath of this.dirs) {
      if (dirPath !== path && dirPath.startsWith(prefix)) {
        const relative = dirPath.slice(prefix.length);
        if (!relative.includes('/')) {
          results.push(relative);
        }
      }
    }
    return results;
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (options?.recursive) {
      const prefix = path === '/' ? '/' : `${path}/`;
      for (const filePath of Array.from(this.files.keys())) {
        if (filePath.startsWith(prefix)) {
          this.files.delete(filePath);
        }
      }
      for (const dirPath of Array.from(this.dirs)) {
        if (dirPath.startsWith(prefix)) {
          this.dirs.delete(dirPath);
        }
      }
    }
    this.dirs.delete(path);
  }

  async stat(path: string): Promise<VfsStat> {
    if (this.files.has(path)) {
      const content = this.files.get(path)!;
      return {
        size: content.length,
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
    throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
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
      throw new Error(`ENOENT: no such file or directory, rename '${from}'`);
    }
  }

  async copyFile(from: string, to: string): Promise<void> {
    const content = this.files.get(from);
    if (!content) {
      throw new Error(`ENOENT: no such file or directory, copyfile '${from}'`);
    }
    this.files.set(to, content);
  }
}

/**
 * Example usage in browser
 */
async function example() {
  // Create VFS with in-memory provider
  const provider = new InMemoryProvider();
  const vfs = createVfs(provider);
  await vfs.initialize();
  
  // Add some sample files
  await vfs.createFile('/README.md', '# My Project\n\nWelcome!');
  await vfs.createFolder('/src');
  await vfs.createFile('/src/index.ts', 'console.log("Hello World");');

  // Create VFS browser client
  const client = new VfsBrowserClient(vfs);

  // Parse callback URL (in real app, get this from window.location.href)
  const callbackUrl = 'https://example.com/connect?vscode_ws=ws://localhost:54321&token=abc123';
  const options = VfsBrowserClient.parseCallbackUrl(callbackUrl);

  console.log('Connecting to VS Code...');
  
  try {
    await client.connect(options);
    console.log('✓ Connected to VS Code!');
    console.log('You can now edit files in VS Code.');
  } catch (error) {
    console.error('✗ Connection failed:', error);
  }
}

// In a real browser app, call this when user clicks the callback URL
// example();

export { InMemoryProvider, example };
