import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Pack an unpacked artifact directory into a temporary ZIP file.
 * Returns the path to the generated ZIP.
 *
 * The ZIP is created in a system temp directory and should be cleaned up
 * by the caller or left for OS temp cleanup.
 */
export function packArtifact(artifactDir: string): string {
  const tmp = mkdtempSync(path.join(tmpdir(), 'e2e-artifact-'));
  const zipPath = path.join(tmp, 'artifact.zip');

  // Use system `zip` to create the archive from the artifact directory
  execSync(`zip -r ${JSON.stringify(zipPath)} .`, {
    cwd: artifactDir,
    stdio: 'ignore',
  });

  return zipPath;
}
