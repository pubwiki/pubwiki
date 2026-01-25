// 自动生成的 OpenAPI 类型
export type * from './generated/openapi';
export type { paths, components, operations } from './generated/openapi';

// 自定义类型（非自动生成）
export type { TextContent, GameRef, ReaderContentBlock, ReaderContent } from './types/content';

// 便捷类型别名
import type { components, operations } from './generated/openapi';

// Schema 类型
export type ApiError = components['schemas']['ApiError'];
export type PublicUser = components['schemas']['PublicUser'];
export type JwtPayload = components['schemas']['JwtPayload'];
export type UpdateProfileRequest = components['schemas']['UpdateProfileRequest'];
export type ArtifactType = components['schemas']['ArtifactType'];
export type Tag = components['schemas']['Tag'];
export type ArtifactListItem = components['schemas']['ArtifactListItem'];
export type Pagination = components['schemas']['Pagination'];
export type VisibilityType = components['schemas']['VisibilityType'];
export type ArtifactVersion = components['schemas']['ArtifactVersion'];
export type LineageType = components['schemas']['LineageType'];
export type ArtifactLineageItem = components['schemas']['ArtifactLineageItem'];
export type ProjectRole = components['schemas']['ProjectRole'];
export type CreateProjectRole = components['schemas']['CreateProjectRole'];
export type ProjectListItem = components['schemas']['ProjectListItem'];
export type ProjectArtifact = components['schemas']['ProjectArtifact'];
export type ProjectDetail = components['schemas']['ProjectDetail'];
export type UserProjectRole = components['schemas']['UserProjectRole'];
export type UserProjectListItem = components['schemas']['UserProjectListItem'];
export type CreateProjectMetadata = components['schemas']['CreateProjectMetadata'];
export type CreateProjectPage = components['schemas']['CreateProjectPage'];
export type ProjectPage = components['schemas']['ProjectPage'];
export type ProjectPageDetail = components['schemas']['ProjectPageDetail'];

// Node 相关类型
export type ArtifactNodeType = components['schemas']['ArtifactNodeType'];
export type ArtifactNodeDescriptor = components['schemas']['ArtifactNodeDescriptor'];
export type ArtifactEdgeDescriptor = components['schemas']['ArtifactEdgeDescriptor'];
export type ArtifactDescriptor = components['schemas']['ArtifactDescriptor'];
export type ArtifactNodeSummary = components['schemas']['ArtifactNodeSummary'];
export type ArtifactEdge = components['schemas']['ArtifactEdge'];
export type NodeVersionInfo = components['schemas']['NodeVersionInfo'];
export type NodeFileInfo = components['schemas']['NodeFileInfo'];

// Discussion 相关类型
export type DiscussionTargetType = components['schemas']['DiscussionTargetType'];
export type DiscussionCategory = components['schemas']['DiscussionCategory'];
export type DiscussionAuthor = components['schemas']['DiscussionAuthor'];
export type DiscussionListItem = components['schemas']['DiscussionListItem'];
export type DiscussionDetail = components['schemas']['DiscussionDetail'];
export type DiscussionReplyItem = components['schemas']['DiscussionReplyItem'];
export type CreateDiscussionRequest = components['schemas']['CreateDiscussionRequest'];
export type UpdateDiscussionRequest = components['schemas']['UpdateDiscussionRequest'];
export type CreateDiscussionReplyRequest = components['schemas']['CreateDiscussionReplyRequest'];

// Post 相关类型
export type PostAuthor = components['schemas']['PostAuthor'];
export type PostListItem = components['schemas']['PostListItem'];
export type PostDetail = components['schemas']['PostDetail'];
export type CreatePostRequest = components['schemas']['CreatePostRequest'];
export type UpdatePostRequest = components['schemas']['UpdatePostRequest'];

// Article 相关类型
export type ArticleAuthor = components['schemas']['ArticleAuthor'];
export type ArticleDetail = components['schemas']['ArticleDetail'];
export type UpsertArticleRequest = components['schemas']['UpsertArticleRequest'];

// Cloud Saves 相关类型
export type CloudSave = components['schemas']['CloudSave'];
export type CreateSaveRequest = components['schemas']['CreateSaveRequest'];
export type CheckpointInfo = components['schemas']['CheckpointInfo'];
export type CreateCheckpointRequest = components['schemas']['CreateCheckpointRequest'];
export type CreateCheckpointResponse = components['schemas']['CreateCheckpointResponse'];
export type TextPatch = components['schemas']['TextPatch'];
export type RefNode = components['schemas']['RefNode'];
export type VersionHistoryResponse = components['schemas']['VersionHistoryResponse'];
// Blockchain-style Verifiable Sync 类型
export type OperationWithRef = components['schemas']['OperationWithRef'];
export type SyncOperationsRequest = components['schemas']['SyncOperationsRequest'];
export type SyncErrorType = components['schemas']['SyncErrorType'];
export type RefMismatchInfo = components['schemas']['RefMismatchInfo'];
export type SyncOperationsResponse = components['schemas']['SyncOperationsResponse'];

// 请求类型
export type RegisterRequest = operations['register']['requestBody']['content']['application/json'];
export type LoginRequest = operations['login']['requestBody']['content']['application/json'];

// 响应类型
export type HealthCheckResponse = operations['healthCheck']['responses']['200']['content']['application/json'];
export type RegisterResponse = operations['register']['responses']['201']['content']['application/json'];
export type LoginResponse = operations['login']['responses']['200']['content']['application/json'];
export type GetMeResponse = operations['getMe']['responses']['200']['content']['application/json'];
export type UpdateProfileResponse = operations['updateProfile']['responses']['200']['content']['application/json'];
export type ListArtifactsResponse = operations['listArtifacts']['responses']['200']['content']['application/json'];
export type GetArtifactLineageResponse = operations['getArtifactLineage']['responses']['200']['content']['application/json'];
export type ListProjectsResponse = operations['listProjects']['responses']['200']['content']['application/json'];
export type GetProjectDetailResponse = operations['getProjectDetail']['responses']['200']['content']['application/json'];
export type GetProjectPageResponse = operations['getProjectPage']['responses']['200']['content']['application/json'];
export type GetArtifactHomepageResponse = operations['getArtifactHomepage']['responses']['200']['content']['text/html'];
export type CreateArtifactResponse = operations['createArtifact']['responses']['201']['content']['application/json'];
export type GetUserArtifactsResponse = operations['getUserArtifacts']['responses']['200']['content']['application/json'];
export type GetUserProjectsResponse = operations['getUserProjects']['responses']['200']['content']['application/json'];
export type CreateProjectResponse = operations['createProject']['responses']['201']['content']['application/json'];

// Node 响应类型
export type GetArtifactGraphResponse = operations['getArtifactGraph']['responses']['200']['content']['application/json'];
export type GetNodeDetailResponse = operations['getNodeDetail']['responses']['200']['content']['application/json'];

// Discussion 响应类型
export type ListDiscussionsResponse = operations['listDiscussions']['responses']['200']['content']['application/json'];
export type CreateDiscussionResponse = operations['createDiscussion']['responses']['201']['content']['application/json'];
export type GetDiscussionResponse = operations['getDiscussion']['responses']['200']['content']['application/json'];
export type UpdateDiscussionResponse = operations['updateDiscussion']['responses']['200']['content']['application/json'];
export type ListDiscussionRepliesResponse = operations['listDiscussionReplies']['responses']['200']['content']['application/json'];
export type CreateDiscussionReplyResponse = operations['createDiscussionReply']['responses']['201']['content']['application/json'];

// Post 响应类型
export type ListProjectPostsResponse = operations['listProjectPosts']['responses']['200']['content']['application/json'];
export type CreateProjectPostResponse = operations['createProjectPost']['responses']['201']['content']['application/json'];
export type GetProjectPostResponse = operations['getProjectPost']['responses']['200']['content']['application/json'];
export type UpdateProjectPostResponse = operations['updateProjectPost']['responses']['200']['content']['application/json'];
export type DeleteProjectPostResponse = operations['deleteProjectPost']['responses']['200']['content']['application/json'];

// Article 响应类型
export type GetArticleResponse = operations['getArticle']['responses']['200']['content']['application/json'];
export type UpsertArticleResponse = operations['upsertArticle']['responses']['200']['content']['application/json'];
export type ListArticlesBySandboxResponse = operations['listArticlesBySandbox']['responses']['200']['content']['application/json'];

// Schema 类型（用于请求体）
export type CreateArtifactMetadata = components['schemas']['CreateArtifactMetadata'];

// 查询参数类型
export type ListArtifactsQuery = operations['listArtifacts']['parameters']['query'];
export type ListProjectsQuery = operations['listProjects']['parameters']['query'];
export type GetUserArtifactsQuery = operations['getUserArtifacts']['parameters']['query'];
export type GetUserProjectsQuery = operations['getUserProjects']['parameters']['query'];
export type ListDiscussionsQuery = operations['listDiscussions']['parameters']['query'];
export type ListDiscussionRepliesQuery = operations['listDiscussionReplies']['parameters']['query'];
export type ListProjectPostsQuery = operations['listProjectPosts']['parameters']['query'];
export type ListArticlesBySandboxQuery = operations['listArticlesBySandbox']['parameters']['query'];
