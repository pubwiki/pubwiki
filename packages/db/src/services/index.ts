export { UserService, type PublicUser, type ServiceError, type ServiceResult } from './user';
export { ArtifactService, type ArtifactListItem, type Pagination, type ListArtifactsParams, type ListArtifactsResult, type ArtifactVersionItem, type ArtifactLineageItem, type GetLineageParams, type CreateArtifactInput, type CreateArtifactResult, type PatchArtifactResult, type PatchArtifactInput, type CreateSaveInput, type ListUserArtifactsParams, type CreateArtifactNode } from './artifact';
export { TagService, type TagInfo, type SyncTagsResult } from './tag';
export { ProjectService, type ProjectListItem, type ListProjectsParams, type ListProjectsResult, type ProjectDetail, type ProjectArtifactItem, type UserProjectListItem, type ListUserProjectsParams, type ListUserProjectsResult, type CreateProjectParams, type CreateProjectMetadata, type ListProjectArtifactsParams, type ListProjectArtifactsResult, type LinkArtifactToProjectParams } from './project';
export { DiscussionService, type DiscussionTarget, type ListDiscussionsParams, type ListDiscussionsResult, type ListRepliesParams, type ListRepliesResult, type DiscussionListItem, type DiscussionDetail, type DiscussionReplyItem } from './discussion';
export { PostService, type PostListItem, type PostDetail, type ListPostsParams, type ListPostsResult, type CreatePostParams, type UpdatePostParams } from './post';
export { ArticleService, type ArticleDetail, type UpsertArticleParams, type ListArticlesByArtifactParams, type ListArticlesByArtifactResult } from './article';

// Version Control First-Class Citizen
export { NodeVersionService, type NodeVersionSummary, type NodeVersionDetail, type SyncNodeVersionInput, type SyncResult } from './node-version';
export { SaveService, type SaveDetail, type CreateSaveParams, type ListSavesParams, type ListSavesResult } from './save';

// Access Control
export * from './access-control';
