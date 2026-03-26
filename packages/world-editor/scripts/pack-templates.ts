/**
 * Build script: pack template directories into .tar.gz archives.
 *
 * Usage:  npx tsx scripts/pack-templates.ts
 *
 * Reads  templates/backend/  and  templates/frontend/  and  packages/game-sdk/src/  and  packages/game-ui/src/
 * Writes dist/templates/{backend,frontend,game-sdk,game-ui}.tar.gz
 */

import { createTar, type TarEntry } from '@pubwiki/flow-core';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);

const ROOT = join(import.meta.dirname!, '..');

/** Template sources: name → source directory */
const TEMPLATES: { name: string; srcDir: string }[] = [
  { name: 'backend',  srcDir: join(ROOT, 'templates', 'backend') },
  { name: 'frontend', srcDir: join(ROOT, 'templates', 'frontend') },
  { name: 'game-sdk', srcDir: join(ROOT, '..', '..', 'packages', 'game-sdk', 'src') },
  { name: 'game-ui',  srcDir: join(ROOT, '..', '..', 'packages', 'game-ui', 'src') },
];

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
  const outDir = join(ROOT, 'dist', 'templates');
  const staticDir = join(ROOT, '..', '..', 'apps', 'studio', 'static', 'templates');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(staticDir, { recursive: true });

  for (const { name, srcDir } of TEMPLATES) {
    const entries = collectFiles(srcDir);
    const tar = createTar(entries);
    const gz = await gzipAsync(tar);
    const outPath = join(outDir, `${name}.tar.gz`);
    writeFileSync(outPath, gz);
    // Also copy to studio static so they are served at /templates/*.tar.gz
    copyFileSync(outPath, join(staticDir, `${name}.tar.gz`));
    console.log(`${name}: ${entries.length} files → ${outPath} (${gz.length} bytes)`);
  }
}

main();
