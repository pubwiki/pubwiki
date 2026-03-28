/**
 * VfsSkillFileProvider — bridges NodeVfs to SkillFileProvider interface.
 *
 * Reads .md skill files from a VFS node populated by SimpleModeBridge.
 */

import type { NodeVfs } from '$lib/vfs';
import type { SkillFileProvider } from '@pubwiki/world-editor';

export class VfsSkillFileProvider implements SkillFileProvider {
  constructor(private readonly vfs: NodeVfs) {}

  async listFiles(): Promise<string[]> {
    try {
      const entries = await this.vfs.listFolder('/');
      return entries
        .filter(e => 'size' in e && e.name.endsWith('.md'))
        .map(e => e.name);
    } catch {
      return [];
    }
  }

  async readFile(filename: string): Promise<string | null> {
    try {
      const path = filename.startsWith('/') ? filename : `/${filename}`;
      const content = await this.vfs.readFile(path);
      if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
        return new TextDecoder().decode(content);
      }
      if (typeof content === 'string') return content;
      return null;
    } catch {
      return null;
    }
  }
}
