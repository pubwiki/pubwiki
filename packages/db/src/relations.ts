import { relations } from 'drizzle-orm';
import { users, userOauth, userFollows } from './schema/users';
import { artifacts, artifactVersions, tags, artifactTags } from './schema/artifacts';
import { artifactNodes, artifactNodeVersions, artifactNodeFiles, artifactNodeRefs } from './schema/nodes';
import { artifactLineage, artifactGenerationParams } from './schema/lineage';
import { artifactStats, artifactStars, artifactViews } from './schema/stats';
import { discussions, discussionReplies } from './schema/discussions';
import { artifactRuns } from './schema/runs';
import { notifications } from './schema/notifications';
import { artifactCollaborators, collections, collectionItems } from './schema/collaboration';
import { projects, projectRoles, projectMaintainers, projectArtifacts, projectPages } from './schema/projects';
import { projectPosts } from './schema/posts';

// Users relations
export const usersRelations = relations(users, ({ many }) => ({
  oauthAccounts: many(userOauth),
  followers: many(userFollows, { relationName: 'following' }),
  following: many(userFollows, { relationName: 'follower' }),
  artifacts: many(artifacts),
  stars: many(artifactStars),
  views: many(artifactViews),
  discussions: many(discussions),
  replies: many(discussionReplies),
  runs: many(artifactRuns),
  notifications: many(notifications),
  collaborations: many(artifactCollaborators),
  collections: many(collections),
  ownedProjects: many(projects),
  maintainedProjects: many(projectMaintainers),
}));

// User OAuth relations
export const userOauthRelations = relations(userOauth, ({ one }) => ({
  user: one(users, {
    fields: [userOauth.userId],
    references: [users.id],
  }),
}));

// User follows relations
export const userFollowsRelations = relations(userFollows, ({ one }) => ({
  follower: one(users, {
    fields: [userFollows.followerId],
    references: [users.id],
    relationName: 'follower',
  }),
  following: one(users, {
    fields: [userFollows.followingId],
    references: [users.id],
    relationName: 'following',
  }),
}));

// Artifacts relations
export const artifactsRelations = relations(artifacts, ({ one, many }) => ({
  author: one(users, {
    fields: [artifacts.authorId],
    references: [users.id],
  }),
  currentVersion: one(artifactVersions, {
    fields: [artifacts.currentVersionId],
    references: [artifactVersions.id],
  }),
  versions: many(artifactVersions),
  nodes: many(artifactNodes),
  tags: many(artifactTags),
  stats: one(artifactStats),
  stars: many(artifactStars),
  views: many(artifactViews),
  runs: many(artifactRuns),
  collaborators: many(artifactCollaborators),
  collectionItems: many(collectionItems),
  childLineage: many(artifactLineage, { relationName: 'child' }),
  parentLineage: many(artifactLineage, { relationName: 'parent' }),
  projectArtifacts: many(projectArtifacts),
  nodeRefs: many(artifactNodeRefs, { relationName: 'externalArtifact' }),
}));

// Artifact versions relations
export const artifactVersionsRelations = relations(artifactVersions, ({ one, many }) => ({
  artifact: one(artifacts, {
    fields: [artifactVersions.artifactId],
    references: [artifacts.id],
  }),
  generationParams: one(artifactGenerationParams),
  runs: many(artifactRuns),
  nodeRefs: many(artifactNodeRefs),
}));

// Artifact nodes relations
export const artifactNodesRelations = relations(artifactNodes, ({ one, many }) => ({
  artifact: one(artifacts, {
    fields: [artifactNodes.artifactId],
    references: [artifacts.id],
  }),
  versions: many(artifactNodeVersions),
}));

// Artifact node versions relations
export const artifactNodeVersionsRelations = relations(artifactNodeVersions, ({ one, many }) => ({
  node: one(artifactNodes, {
    fields: [artifactNodeVersions.nodeId],
    references: [artifactNodes.id],
  }),
  files: many(artifactNodeFiles),
}));

// Artifact node files relations
export const artifactNodeFilesRelations = relations(artifactNodeFiles, ({ one }) => ({
  version: one(artifactNodeVersions, {
    fields: [artifactNodeFiles.nodeVersionId],
    references: [artifactNodeVersions.id],
  }),
}));

// Artifact node refs relations
export const artifactNodeRefsRelations = relations(artifactNodeRefs, ({ one }) => ({
  artifactVersion: one(artifactVersions, {
    fields: [artifactNodeRefs.artifactVersionId],
    references: [artifactVersions.id],
  }),
  externalArtifact: one(artifacts, {
    fields: [artifactNodeRefs.externalArtifactId],
    references: [artifacts.id],
    relationName: 'externalArtifact',
  }),
}));

// Tags relations
export const tagsRelations = relations(tags, ({ many }) => ({
  artifactTags: many(artifactTags),
}));

// Artifact tags relations
export const artifactTagsRelations = relations(artifactTags, ({ one }) => ({
  artifact: one(artifacts, {
    fields: [artifactTags.artifactId],
    references: [artifacts.id],
  }),
  tag: one(tags, {
    fields: [artifactTags.tagId],
    references: [tags.id],
  }),
}));

// Artifact lineage relations
export const artifactLineageRelations = relations(artifactLineage, ({ one }) => ({
  child: one(artifacts, {
    fields: [artifactLineage.childArtifactId],
    references: [artifacts.id],
    relationName: 'child',
  }),
  parent: one(artifacts, {
    fields: [artifactLineage.parentArtifactId],
    references: [artifacts.id],
    relationName: 'parent',
  }),
}));

// Artifact generation params relations
export const artifactGenerationParamsRelations = relations(artifactGenerationParams, ({ one }) => ({
  version: one(artifactVersions, {
    fields: [artifactGenerationParams.versionId],
    references: [artifactVersions.id],
  }),
}));

// Artifact stats relations
export const artifactStatsRelations = relations(artifactStats, ({ one }) => ({
  artifact: one(artifacts, {
    fields: [artifactStats.artifactId],
    references: [artifacts.id],
  }),
}));

// Artifact stars relations
export const artifactStarsRelations = relations(artifactStars, ({ one }) => ({
  user: one(users, {
    fields: [artifactStars.userId],
    references: [users.id],
  }),
  artifact: one(artifacts, {
    fields: [artifactStars.artifactId],
    references: [artifacts.id],
  }),
}));

// Artifact views relations
export const artifactViewsRelations = relations(artifactViews, ({ one }) => ({
  artifact: one(artifacts, {
    fields: [artifactViews.artifactId],
    references: [artifacts.id],
  }),
  user: one(users, {
    fields: [artifactViews.userId],
    references: [users.id],
  }),
}));

// Discussions relations (多态关联，不直接关联到特定表)
export const discussionsRelations = relations(discussions, ({ one, many }) => ({
  author: one(users, {
    fields: [discussions.authorId],
    references: [users.id],
  }),
  replies: many(discussionReplies),
}));

// Discussion replies relations
export const discussionRepliesRelations = relations(discussionReplies, ({ one, many }) => ({
  discussion: one(discussions, {
    fields: [discussionReplies.discussionId],
    references: [discussions.id],
  }),
  author: one(users, {
    fields: [discussionReplies.authorId],
    references: [users.id],
  }),
  parentReply: one(discussionReplies, {
    fields: [discussionReplies.parentReplyId],
    references: [discussionReplies.id],
    relationName: 'parentReply',
  }),
  childReplies: many(discussionReplies, { relationName: 'parentReply' }),
}));

// Artifact runs relations
export const artifactRunsRelations = relations(artifactRuns, ({ one }) => ({
  artifact: one(artifacts, {
    fields: [artifactRuns.artifactId],
    references: [artifacts.id],
  }),
  version: one(artifactVersions, {
    fields: [artifactRuns.versionId],
    references: [artifactVersions.id],
  }),
  user: one(users, {
    fields: [artifactRuns.userId],
    references: [users.id],
  }),
}));

// Notifications relations
export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}));

// Artifact collaborators relations
export const artifactCollaboratorsRelations = relations(artifactCollaborators, ({ one }) => ({
  artifact: one(artifacts, {
    fields: [artifactCollaborators.artifactId],
    references: [artifacts.id],
  }),
  user: one(users, {
    fields: [artifactCollaborators.userId],
    references: [users.id],
  }),
}));

// Collections relations
export const collectionsRelations = relations(collections, ({ one, many }) => ({
  user: one(users, {
    fields: [collections.userId],
    references: [users.id],
  }),
  items: many(collectionItems),
}));

// Collection items relations
export const collectionItemsRelations = relations(collectionItems, ({ one }) => ({
  collection: one(collections, {
    fields: [collectionItems.collectionId],
    references: [collections.id],
  }),
  artifact: one(artifacts, {
    fields: [collectionItems.artifactId],
    references: [artifacts.id],
  }),
}));

// Projects relations
export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, {
    fields: [projects.ownerId],
    references: [users.id],
  }),
  homepage: one(projectPages, {
    fields: [projects.homepageId],
    references: [projectPages.id],
  }),
  maintainers: many(projectMaintainers),
  roles: many(projectRoles),
  artifacts: many(projectArtifacts),
  pages: many(projectPages),
  posts: many(projectPosts),
}));

// Project pages relations
export const projectPagesRelations = relations(projectPages, ({ one }) => ({
  project: one(projects, {
    fields: [projectPages.projectId],
    references: [projects.id],
  }),
}));

// Project roles relations
export const projectRolesRelations = relations(projectRoles, ({ one, many }) => ({
  project: one(projects, {
    fields: [projectRoles.projectId],
    references: [projects.id],
  }),
  projectArtifacts: many(projectArtifacts),
}));

// Project maintainers relations
export const projectMaintainersRelations = relations(projectMaintainers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMaintainers.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [projectMaintainers.userId],
    references: [users.id],
  }),
}));

// Project artifacts relations
export const projectArtifactsRelations = relations(projectArtifacts, ({ one }) => ({
  project: one(projects, {
    fields: [projectArtifacts.projectId],
    references: [projects.id],
  }),
  artifact: one(artifacts, {
    fields: [projectArtifacts.artifactId],
    references: [artifacts.id],
  }),
  role: one(projectRoles, {
    fields: [projectArtifacts.roleId],
    references: [projectRoles.id],
  }),
}));

// Project posts relations
export const projectPostsRelations = relations(projectPosts, ({ one }) => ({
  project: one(projects, {
    fields: [projectPosts.projectId],
    references: [projects.id],
  }),
  author: one(users, {
    fields: [projectPosts.authorId],
    references: [users.id],
  }),
  discussion: one(discussions, {
    fields: [projectPosts.discussionId],
    references: [discussions.id],
  }),
}));
