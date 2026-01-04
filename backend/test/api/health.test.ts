import { describe, it, expect, beforeEach } from 'vitest';
import type { HealthCheckResponse } from '@pubwiki/api';
import { getTestDb, clearDatabase, sendRequest, type TestDb } from './helpers';

describe('Health Check API', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = getTestDb();
    await clearDatabase(db);
  });

  describe('GET /api', () => {
    it('should return health check response', async () => {
      const request = new Request('http://localhost/api');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<HealthCheckResponse>();
      expect(data.message).toBe('PubWiki API is running');
      expect(data.version).toBe('1.0.0');
    });
  });
});
