import { relations } from 'drizzle-orm';
import { user, session, account, userFollows } from './schema/auth';
import { artifacts, artifactVersions, tags, artifactTags } from './schema/artifacts';
import { artifactStats, artifactStars, artifactViews } from './schema/stats';
import { discussions, discussionReplies } from './schema/discussions';
import { artifactRuns } from './schema/runs';
import { notifications } from './schema/notifications';
import { artifactCollaborators, collections, collectionItems } from './schema/collaboration';
import { projects, projectRoles, projectMaintainers, projectArtifacts, projectPages } from './schema/projects';
import { projectPosts } from './schema/posts';
import { articles } from './schema/articles';
import { nodeVersions, nodeVersionRefs } from './schema/node-versions';
import { artifactVersionNodes, artifactVersionEdges } from './schema/artifact-version-graph';

// User relations (Better-Auth)
export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
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
  articles: many(articles),
  nodeVersions: many(nodeVersions),
}));

// Session relations (Better-Auth)
export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

// Account relations (Better-Auth)
export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

// User follows relations
export const userFollowsRelations = relations(userFollows, ({ one }) => ({
  follower: one(user, {
    fields: [userFollows.followerId],
    references: [user.id],
    relationName: 'follower',
  }),
  following: one(user, {
    fields: [userFollows.followingId],
    references: [user.id],
    relationName: 'following',
  }),
}));

// Artifacts relations
export const artifactsRelations = relations(artifacts, ({ one, many }) => ({
  author: one(user, {
    fields: [artifacts.authorId],
    references: [user.id],
  }),
  currentVersion: one(artifactVersions, {
    fields: [artifacts.currentVersionId],
    references: [artifactVersions.id],
  }),
  versions: many(artifactVersions),
  tags: many(artifactTags),
  stats: one(artifactStats),
  stars: many(artifactStars),
  views: many(artifactViews),
  runs: many(artifactRuns),
  collaborators: many(artifactCollaborators),
  collectionItems: many(collectionItems),
  projectArtifacts: many(projectArtifacts),
}));

// Artifact versions relations
export const artifactVersionsRelations = relations(artifactVersions, ({ one, many }) => ({
  artifact: one(artifacts, {
    fields: [artifactVersions.artifactId],
    references: [artifacts.id],
  }),
  runs: many(artifactRuns),
  // Version graph composition (new architecture)
  versionNodes: many(artifactVersionNodes),
  versionEdges: many(artifactVersionEdges),
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

// Artifact stats relations
export const artifactStatsRelations = relations(artifactStats, ({ one }) => ({
  artifact: one(artifacts, {
    fields: [artifactStats.artifactId],
    references: [artifacts.id],
  }),
}));

// Artifact stars relations
export const artifactStarsRelations = relations(artifactStars, ({ one }) => ({
  user: one(user, {
    fields: [artifactStars.userId],
    references: [user.id],
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
  user: one(user, {
    fields: [artifactViews.userId],
    references: [user.id],
  }),
}));

// Discussions relations (多态关联，不直接关联到特定表)
export const discussionsRelations = relations(discussions, ({ one, many }) => ({
  author: one(user, {
    fields: [discussions.authorId],
    references: [user.id],
  }),
  replies: many(discussionReplies),
}));

// Discussion replies relations
export const discussionRepliesRelations = relations(discussionReplies, ({ one, many }) => ({
  discussion: one(discussions, {
    fields: [discussionReplies.discussionId],
    references: [discussions.id],
  }),
  author: one(user, {
    fields: [discussionReplies.authorId],
    references: [user.id],
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
  user: one(user, {
    fields: [artifactRuns.userId],
    references: [user.id],
  }),
}));

// Notifications relations
export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(user, {
    fields: [notifications.userId],
    references: [user.id],
  }),
}));

// Artifact collaborators relations
export const artifactCollaboratorsRelations = relations(artifactCollaborators, ({ one }) => ({
  artifact: one(artifacts, {
    fields: [artifactCollaborators.artifactId],
    references: [artifacts.id],
  }),
  user: one(user, {
    fields: [artifactCollaborators.userId],
    references: [user.id],
  }),
}));

// Collections relations
export const collectionsRelations = relations(collections, ({ one, many }) => ({
  user: one(user, {
    fields: [collections.userId],
    references: [user.id],
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
  owner: one(user, {
    fields: [projects.ownerId],
    references: [user.id],
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
  user: one(user, {
    fields: [projectMaintainers.userId],
    references: [user.id],
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
  author: one(user, {
    fields: [projectPosts.authorId],
    references: [user.id],
  }),
  discussion: one(discussions, {
    fields: [projectPosts.discussionId],
    references: [discussions.id],
  }),
}));

// Articles relations
export const articlesRelations = relations(articles, ({ one }) => ({
  author: one(user, {
    fields: [articles.authorId],
    references: [user.id],
  }),
}));

// ========================================================================
// Version Control First-Class Citizen Relations
// ========================================================================

// Node versions relations
export const nodeVersionsRelations = relations(nodeVersions, ({ one, many }) => ({
  author: one(user, {
    fields: [nodeVersions.authorId],
    references: [user.id],
  }),
  // 版本发出的引用（作为 source）
  outgoingRefs: many(nodeVersionRefs, { relationName: 'source' }),
  // 版本被引用（作为 target）
  incomingRefs: many(nodeVersionRefs, { relationName: 'target' }),
  // 该版本出现在哪些 artifact version 中
  artifactVersionNodes: many(artifactVersionNodes),
}));

// Node version refs relations
export const nodeVersionRefsRelations = relations(nodeVersionRefs, ({ one }) => ({
  source: one(nodeVersions, {
    fields: [nodeVersionRefs.sourceCommit],
    references: [nodeVersions.commit],
    relationName: 'source',
  }),
  target: one(nodeVersions, {
    fields: [nodeVersionRefs.targetCommit],
    references: [nodeVersions.commit],
    relationName: 'target',
  }),
}));

// Artifact version nodes relations
export const artifactVersionNodesRelations = relations(artifactVersionNodes, ({ one }) => ({
  artifactVersion: one(artifactVersions, {
    fields: [artifactVersionNodes.commitHash],
    references: [artifactVersions.commitHash],
  }),
  nodeVersion: one(nodeVersions, {
    fields: [artifactVersionNodes.nodeCommit],
    references: [nodeVersions.commit],
  }),
}));

// Artifact version edges relations
export const artifactVersionEdgesRelations = relations(artifactVersionEdges, ({ one }) => ({
  artifactVersion: one(artifactVersions, {
    fields: [artifactVersionEdges.commitHash],
    references: [artifactVersions.commitHash],
  }),
}));
