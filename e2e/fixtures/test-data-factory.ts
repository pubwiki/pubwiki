/**
 * Test data factory — creates backend data via the API so browser tests
 * have something to interact with.
 *
 * Every factory function accepts a `testId` string that is baked into
 * names / emails so that tests running in parallel never collide.
 */

import { getApiBaseUrl } from './constants.js';
import { registerUser, authedFetch } from './api-client.js';
import { computeArtifactCommit } from '@pubwiki/api';

/* ------------------------------------------------------------------ */
/*  Users                                                              */
/* ------------------------------------------------------------------ */

export async function createUser(testId: string) {
  const username = `e2e_${testId.replace(/[^a-zA-Z0-9_.]/g, '_')}`;
  return registerUser(username);
}

/* ------------------------------------------------------------------ */
/*  Artifacts                                                          */
/* ------------------------------------------------------------------ */

export interface CreateArtifactOptions {
  sessionCookie: string;
  name: string;
  description?: string;
}

export async function createArtifact(opts: CreateArtifactOptions) {
  const fetchFn = authedFetch(opts.sessionCookie);
  const artifactId = crypto.randomUUID();
  const commit = await computeArtifactCommit(artifactId, null, [], []);

  const metadata = {
    artifactId,
    commit,
    name: opts.name,
    description: opts.description ?? `E2E test artifact: ${opts.name}`,
  };

  const formData = new FormData();
  formData.append('metadata', JSON.stringify(metadata));
  formData.append('nodes', JSON.stringify([]));
  formData.append('edges', JSON.stringify([]));

  const res = await fetchFn(`${getApiBaseUrl()}/artifacts`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    throw new Error(`createArtifact failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { artifact: { id: string } };
  return { id: body.artifact.id };
}

/* ------------------------------------------------------------------ */
/*  Projects                                                           */
/* ------------------------------------------------------------------ */

export interface CreateProjectOptions {
  sessionCookie: string;
  name: string;
  description?: string;
}

export async function createProject(opts: CreateProjectOptions) {
  const fetch = authedFetch(opts.sessionCookie);
  const res = await fetch(`${getApiBaseUrl()}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: opts.name,
      description: opts.description ?? `E2E test project: ${opts.name}`,
    }),
  });
  if (!res.ok) {
    throw new Error(`createProject failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { id: string };
}
