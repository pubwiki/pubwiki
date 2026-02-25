import { Hono } from 'hono';
import type { Env } from '../types';
import { BatchContext, createDb, TagService } from '@pubwiki/db';
import type { ListTagsResponse } from '@pubwiki/api';
import { ListTagsQueryParams } from '@pubwiki/api/validate';
import { validateQuery, isValidationError } from '../lib/validate';
import { serviceErrorResponse } from '../lib/service-error';

const tagsRoute = new Hono<{ Bindings: Env }>();

// GET /tags - List tags with optional filtering and pagination
tagsRoute.get('/', async (c) => {
  const ctx = new BatchContext(createDb(c.env.DB));
  const tagService = new TagService(ctx);

  // Validate query parameters
  const validated = validateQuery(c, ListTagsQueryParams, c.req.query());
  if (isValidationError(validated)) return validated;

  const result = await tagService.listTags({
    page: validated.page,
    limit: validated.limit,
    search: validated.search,
    sortBy: validated.sortBy,
    sortOrder: validated.sortOrder,
  });

  if (!result.success) {
    return serviceErrorResponse(c, result.error);
  }

  return c.json<ListTagsResponse>(result.data);
});

export { tagsRoute };
