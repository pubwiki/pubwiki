import { eq, inArray, sql, and, desc, asc, count } from 'drizzle-orm';
import { tags, artifactTags } from '../schema/artifacts';
import type { BatchContext } from '../batch-context';
import type { ServiceResult } from './user';

/**
 * Tag information structure used across the application.
 * Since slug is the primary key, we use it as the identifier.
 */
export interface TagInfo {
  slug: string;
  name: string;
  description: string | null;
  color: string | null;
}

/**
 * Result of syncing tags for an artifact
 */
export interface SyncTagsResult {
  /** Tags that were processed (either existing or newly created) */
  processedTags: TagInfo[];
}

/**
 * Parameters for listing tags
 */
export interface ListTagsParams {
  /** Page number (1-indexed) */
  page?: number;
  /** Number of items per page */
  limit?: number;
  /** Search query to filter tags by name or slug */
  search?: string;
  /** Sort by field */
  sortBy?: 'usageCount' | 'name' | 'createdAt';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Tag list item with usage count
 */
export interface TagListItem extends TagInfo {
  usageCount: number;
}

/**
 * Result of listing tags with pagination
 */
export interface ListTagsResult {
  tags: TagListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * TagService handles all tag-related operations for artifacts.
 * 
 * Responsibilities:
 * - Fetch existing tags by slugs
 * - Get current tags for an artifact
 * - Sync tags (compute diff, add new, remove old, maintain usage counts)
 * - Create new tags with usage count management
 */
export class TagService {
  constructor(private ctx: BatchContext) {}

  /**
   * List tags with optional filtering and pagination.
   * Returns tags sorted by usage count by default.
   */
  async listTags(params: ListTagsParams = {}): Promise<ServiceResult<ListTagsResult>> {
    const {
      page = 1,
      limit = 20,
      search,
      sortBy = 'usageCount',
      sortOrder = 'desc',
    } = params;

    const offset = (page - 1) * limit;

    // Build base query conditions
    const conditions = [];
    if (search) {
      // Search in both slug and name
      conditions.push(
        sql`(${tags.slug} LIKE ${'%' + search + '%'} OR ${tags.name} LIKE ${'%' + search + '%'})`
      );
    }

    // Get total count
    const countQuery = this.ctx.select({ count: count() }).from(tags);
    if (conditions.length > 0) {
      countQuery.where(and(...conditions));
    }
    const [{ count: total }] = await countQuery;

    // Build sort order
    const sortColumn = sortBy === 'usageCount' ? tags.usageCount
      : sortBy === 'name' ? tags.name
      : tags.createdAt;
    const orderFn = sortOrder === 'asc' ? asc : desc;

    // Get paginated results
    const listQuery = this.ctx
      .select({
        slug: tags.slug,
        name: tags.name,
        description: tags.description,
        color: tags.color,
        usageCount: tags.usageCount,
      })
      .from(tags);
    
    if (conditions.length > 0) {
      listQuery.where(and(...conditions));
    }
    
    const tagList = await listQuery
      .orderBy(orderFn(sortColumn))
      .limit(limit)
      .offset(offset);

    return {
      success: true,
      data: {
        tags: tagList,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  /**
   * Fetch existing tags by their slugs.
   * Returns a Map of slug → TagInfo for quick lookup.
   */
  async fetchTagsBySlug(slugs: string[]): Promise<Map<string, TagInfo>> {
    const result = new Map<string, TagInfo>();
    if (slugs.length === 0) return result;

    const existingTags = await this.ctx
      .select()
      .from(tags)
      .where(inArray(tags.slug, slugs));

    for (const tag of existingTags) {
      result.set(tag.slug, {
        slug: tag.slug,
        name: tag.name,
        description: tag.description,
        color: tag.color,
      });
    }

    return result;
  }

  /**
   * Get current tag slugs for an artifact.
   * Since slug is the primary key, we can directly query artifactTags.
   */
  async getArtifactTagSlugs(artifactId: string): Promise<Set<string>> {
    const result = await this.ctx
      .select({ tagSlug: artifactTags.tagSlug })
      .from(artifactTags)
      .where(eq(artifactTags.artifactId, artifactId));

    return new Set(result.map(t => t.tagSlug));
  }

  /**
   * Sync tags for an artifact: compute diff between current and new tags,
   * remove old associations, add new associations, and maintain usage counts.
   * 
   * @param artifactId The artifact ID
   * @param newTagSlugs The desired tag slugs after sync
   * @param existingTagsMap Pre-fetched map of slug → TagInfo (optional optimization)
   * @returns The processed tags info
   */
  async syncTags(
    artifactId: string,
    newTagSlugs: string[],
    existingTagsMap?: Map<string, TagInfo>,
  ): Promise<SyncTagsResult> {
    // Get current tags
    const currentTagSlugs = await this.getArtifactTagSlugs(artifactId);
    const newTagSlugSet = new Set(newTagSlugs);

    // Compute diff
    const tagsToRemove = [...currentTagSlugs].filter(s => !newTagSlugSet.has(s));
    const tagsToAdd = newTagSlugs.filter(s => !currentTagSlugs.has(s));

    // Remove old tags
    if (tagsToRemove.length > 0) {
      await this.removeTagsFromArtifact(artifactId, tagsToRemove);
    }

    // Add new tags
    const processedTags: TagInfo[] = [];
    if (tagsToAdd.length > 0) {
      // Fetch existing tags if not provided
      const tagsMap = existingTagsMap ?? await this.fetchTagsBySlug(tagsToAdd);
      
      for (const slug of tagsToAdd) {
        const tagInfo = await this.addTagToArtifact(artifactId, slug, tagsMap.get(slug));
        processedTags.push(tagInfo);
      }
    }

    // Also include tags that were already present and not removed
    const unchangedSlugs = [...currentTagSlugs].filter(s => newTagSlugSet.has(s));
    if (unchangedSlugs.length > 0) {
      const unchangedTagsMap = existingTagsMap ?? await this.fetchTagsBySlug(unchangedSlugs);
      for (const slug of unchangedSlugs) {
        const tagInfo = unchangedTagsMap.get(slug);
        if (tagInfo) {
          processedTags.push(tagInfo);
        }
      }
    }

    return { processedTags };
  }

  /**
   * Set tags for an artifact (full replacement).
   * Used when creating a new artifact or doing a full tag update.
   * 
   * @param artifactId The artifact ID
   * @param tagSlugs The tag slugs to set
   * @param existingTagsMap Pre-fetched map of slug → TagInfo (optional optimization)
   * @returns The processed tags info
   */
  async setTags(
    artifactId: string,
    tagSlugs: string[],
    existingTagsMap?: Map<string, TagInfo>,
  ): Promise<SyncTagsResult> {
    const processedTags: TagInfo[] = [];
    
    if (tagSlugs.length === 0) {
      return { processedTags };
    }

    // Fetch existing tags if not provided
    const tagsMap = existingTagsMap ?? await this.fetchTagsBySlug(tagSlugs);

    for (const slug of tagSlugs) {
      const tagInfo = await this.addTagToArtifact(artifactId, slug, tagsMap.get(slug));
      processedTags.push(tagInfo);
    }

    return { processedTags };
  }

  /**
   * Remove specific tags from an artifact by slugs.
   * Decrements usage counts for removed tags.
   */
  async removeTagsFromArtifact(artifactId: string, tagSlugs: string[]): Promise<void> {
    if (tagSlugs.length === 0) return;

    for (const slug of tagSlugs) {
      // Delete association
      this.ctx.modify().delete(artifactTags).where(
        and(eq(artifactTags.artifactId, artifactId), eq(artifactTags.tagSlug, slug))
      );
      // Decrement usage count
      this.ctx.modify().update(tags)
        .set({ usageCount: sql`MAX(0, ${tags.usageCount} - 1)` })
        .where(eq(tags.slug, slug));
    }
  }

  /**
   * Add a tag to an artifact.
   * Creates the tag if it doesn't exist, otherwise increments usage count.
   * Only increments usage count if the association doesn't already exist.
   * 
   * @param artifactId The artifact ID
   * @param slug The tag slug (also the primary key)
   * @param existingTag Pre-fetched tag info if available
   * @returns The tag info (either existing or newly created)
   */
  private async addTagToArtifact(
    artifactId: string,
    slug: string,
    existingTag?: TagInfo,
  ): Promise<TagInfo> {
    // Check if association already exists to avoid duplicate counting
    const existingAssociation = await this.ctx
      .select({ tagSlug: artifactTags.tagSlug })
      .from(artifactTags)
      .where(and(
        eq(artifactTags.artifactId, artifactId),
        eq(artifactTags.tagSlug, slug)
      ))
      .limit(1);

    if (existingAssociation.length > 0) {
      // Association already exists, don't increment count
      return existingTag ?? {
        slug: slug,
        name: slug,
        description: null,
        color: null,
      };
    }

    if (!existingTag) {
      // Create new tag (slug is the primary key)
      this.ctx.modify().insert(tags).values({
        slug: slug,
        name: slug,
        usageCount: 1,
      });

      // Create association
      this.ctx.modify().insert(artifactTags).values({
        artifactId,
        tagSlug: slug,
      });

      return {
        slug: slug,
        name: slug,
        description: null,
        color: null,
      };
    } else {
      // Increment usage count for existing tag
      this.ctx.modify().update(tags)
        .set({ usageCount: sql`${tags.usageCount} + 1` })
        .where(eq(tags.slug, existingTag.slug));

      // Create association
      this.ctx.modify().insert(artifactTags).values({
        artifactId,
        tagSlug: existingTag.slug,
      });

      return existingTag;
    }
  }
}
