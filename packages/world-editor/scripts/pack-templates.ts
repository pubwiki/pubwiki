/**
 * Build script: pack template directories into .tar.gz archives.
 *
 * Usage:  npx tsx scripts/pack-templates.ts
 *
 * Reads  templates/backend/  and  templates/frontend/
 * Writes dist/templates/backend.tar.gz  and  dist/templates/frontend.tar.gz
 */

import { createTar, type TarEntry } from '@pubwiki/flow-core';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);

function collectFiles(dir: string, base: string = dir): TarEntry[] {
  const entries: TarEntry[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      entries.push(...collectFiles(full, base));
    } else {
      entries.push({
        path: relative(base, full),
        content: new Uint8Array(readFileSync(full)),
      });
    }
  }
  return entries;
}

async function main() {
  const outDir = join(import.meta.dirname!, '..', 'dist', 'templates');
  mkdirSync(outDir, { recursive: true });

  for (const name of ['backend', 'frontend'] as const) {
    const srcDir = join(import.meta.dirname!, '..', 'templates', name);
    const entries = collectFiles(srcDir);
    const tar = createTar(entries);
    const gz = await gzipAsync(tar);
    const outPath = join(outDir, `${name}.tar.gz`);
    writeFileSync(outPath, gz);
    console.log(`${name}: ${entries.length} files → ${outPath} (${gz.length} bytes)`);
  }
}

main();
