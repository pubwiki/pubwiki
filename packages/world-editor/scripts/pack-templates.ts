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

/** Template sources: name → source directory (+ optional extra files from parent) */
const TEMPLATES: { name: string; srcDir: string; extraFiles?: string[] }[] = [
  { name: 'backend',  srcDir: join(ROOT, 'templates', 'backend') },
  { name: 'frontend', srcDir: join(ROOT, 'templates', 'frontend') },
  { name: 'game-sdk', srcDir: join(ROOT, '..', '..', 'packages', 'game-sdk', 'src'), extraFiles: [join(ROOT, '..', '..', 'packages', 'game-sdk', 'package.json')] },
  { name: 'game-ui',  srcDir: join(ROOT, '..', '..', 'packages', 'game-ui', 'src'), extraFiles: [join(ROOT, '..', '..', 'packages', 'game-ui', 'package.json')] },
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
        // Always use forward slashes in tar paths (OPFS rejects backslashes on Windows)
        path: relative(base, full).replaceAll('\\', '/'),
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

  for (const { name, srcDir, extraFiles } of TEMPLATES) {
    const entries = collectFiles(srcDir);
    // Include extra files (e.g. package.json from parent dir) at archive root
    if (extraFiles) {
      for (const filePath of extraFiles) {
        // Use path.basename equivalent that works on both Windows and Unix
        const fileName = filePath.replace(/\\/g, '/').split('/').pop()!;
        entries.push({
          path: fileName,
          content: new Uint8Array(readFileSync(filePath)),
        });
      }
    }
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
