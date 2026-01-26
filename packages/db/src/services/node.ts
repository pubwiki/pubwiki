import { eq, and, desc } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Database } from '../client';
import { artifacts, artifactVersions } from '../schema/artifacts';
import { 
  artifactNodes, 
  artifactNodeVersions, 
  artifactNodeRefs,
  type ArtifactNode,
  type ArtifactNodeVersion,
} from '../schema/nodes';
import { user } from '../schema/auth';
import type { ServiceError, ServiceResult } from './user';
import type {
  ArtifactNodeSummary,
  ArtifactEdge,
  NodeVersionInfo,
  NodeFileInfo,
  ArtifactNodeType,
  ArtifactNodeContent,
} from '@pubwiki/api';
import type { StoredEdge } from '../schema/artifacts';

// 重新导出类型
export type { ArtifactNodeSummary, ArtifactEdge, NodeVersionInfo, NodeFileInfo };

// 获取图结构响应 - 现在包含节点内容
export interface GetArtifactGraphResult {
  nodes: ArtifactNodeSummary[];
  edges: ArtifactEdge[];
  version: {
    id: string;
    commitHash: string;
    version: string;
    createdAt: string;
  };
}

// 获取节点详情响应 - 包含内容
export interface GetNodeDetailResult {
  id: string;
  type: ArtifactNodeType;
  name: string | null;
  external: boolean;
  externalArtifact?: {
    id: string;
    name: string;
    slug: string;
    author: {
      id: string;
      username: string;
    };
  };
  version: NodeVersionInfo;
  content?: ArtifactNodeContent;
}

// 创建节点输入
export interface CreateNodeInput {
  id: string;
  artifactId: string;
  type: ArtifactNodeType;
  name?: string;
  positionX?: number;
  positionY?: number;
  originalNodeId?: string;
  originalCommit?: string;
}

// 创建节点版本输入 - 现在包含 content 而不是 files
export interface CreateNodeVersionInput {
  nodeId: string;
  commitHash: string;
  contentHash: string;
  content: unknown; // JSON content - 结构化内容或 VFS 文件摘要
  message?: string;
}

export class NodeService {
  constructor(private db: Database) {}

  // 获取 artifact 的图结构（节点和边，包含节点内容）
  async getArtifactGraph(
    artifactId: string,
    versionHash?: string
  ): Promise<ServiceResult<GetArtifactGraphResult>> {
    try {
      // 获取指定版本或最新版本
      let versionResult;
      if (versionHash && versionHash !== 'latest') {
        versionResult = await this.db
          .select()
          .from(artifactVersions)
          .where(
            and(
              eq(artifactVersions.artifactId, artifactId),
              eq(artifactVersions.commitHash, versionHash)
            )
          )
          .limit(1);
      } else {
        versionResult = await this.db
          .select()
          .from(artifactVersions)
          .where(eq(artifactVersions.artifactId, artifactId))
          .orderBy(desc(artifactVersions.createdAt))
          .limit(1);
      }

      if (versionResult.length === 0) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Artifact version not found' },
        };
      }

      const version = versionResult[0];

      // 获取所有内部节点
      const nodesResult = await this.db
        .select()
        .from(artifactNodes)
        .where(eq(artifactNodes.artifactId, artifactId));

      // 获取每个内部节点的最新版本内容
      const nodeContentMap = new Map<string, ArtifactNodeContent>();
      for (const node of nodesResult) {
        const latestVersion = await this.db
          .select()
          .from(artifactNodeVersions)
          .where(eq(artifactNodeVersions.nodeId, node.id))
          .orderBy(desc(artifactNodeVersions.createdAt))
          .limit(1);
        
        if (latestVersion.length > 0 && latestVersion[0].content) {
          try {
            nodeContentMap.set(node.id, JSON.parse(latestVersion[0].content) as ArtifactNodeContent);
          } catch {
            // 忽略解析错误
          }
        }
      }

      // 获取外部节点引用
      const refsResult = await this.db
        .select({
          ref: artifactNodeRefs,
          externalArtifact: artifacts,
          externalNode: artifactNodes,
        })
        .from(artifactNodeRefs)
        .innerJoin(artifacts, eq(artifactNodeRefs.externalArtifactId, artifacts.id))
        .leftJoin(artifactNodes, eq(artifactNodeRefs.externalNodeId, artifactNodes.id))
        .where(eq(artifactNodeRefs.artifactVersionId, version.id));

      // 获取外部节点的内容
      for (const ref of refsResult) {
        const externalVersion = await this.db
          .select()
          .from(artifactNodeVersions)
          .where(eq(artifactNodeVersions.id, ref.ref.externalNodeVersionId))
          .limit(1);
        
        if (externalVersion.length > 0 && externalVersion[0].content) {
          try {
            nodeContentMap.set(ref.ref.externalNodeId, JSON.parse(externalVersion[0].content) as ArtifactNodeContent);
          } catch {
            // 忽略解析错误
          }
        }
      }

      // 构建节点列表（现在包含 content）
      const nodes: ArtifactNodeSummary[] = [
        // 内部节点
        ...nodesResult.map((n) => ({
          id: n.id,
          type: n.type as ArtifactNodeType,
          name: n.name,
          external: false,
          position: n.positionX != null && n.positionY != null 
            ? { x: n.positionX, y: n.positionY } 
            : undefined,
          content: nodeContentMap.get(n.id),
        })),
        // 外部节点引用
        ...refsResult.map((r) => ({
          id: r.ref.externalNodeId,
          type: r.externalNode?.type as ArtifactNodeType || 'PROMPT',
          name: r.externalNode?.name ?? null,
          external: true,
          externalArtifactId: r.ref.externalArtifactId,
          position: r.externalNode?.positionX != null && r.externalNode?.positionY != null
            ? { x: r.externalNode.positionX, y: r.externalNode.positionY }
            : undefined,
          content: nodeContentMap.get(r.ref.externalNodeId),
        })),
      ];

      // 获取边信息
      const edges: ArtifactEdge[] = (version.edges as StoredEdge[] || []).map((e) => ({
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      }));

      return {
        success: true,
        data: {
          nodes,
          edges,
          version: {
            id: version.id,
            commitHash: version.commitHash,
            version: version.version,
            createdAt: version.createdAt,
          },
        },
      };
    } catch (error) {
      console.error('Get artifact graph error:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      };
    }
  }

  // 获取节点详情
  async getNodeDetail(
    artifactId: string,
    nodeId: string,
    versionHash?: string
  ): Promise<ServiceResult<GetNodeDetailResult>> {
    try {
      // 首先检查是否是内部节点
      const nodeResult = await this.db
        .select()
        .from(artifactNodes)
        .where(and(
          eq(artifactNodes.id, nodeId),
          eq(artifactNodes.artifactId, artifactId)
        ))
        .limit(1);

      if (nodeResult.length > 0) {
        // 内部节点
        const node = nodeResult[0];

        // 获取节点版本
        let nodeVersionResult;
        if (versionHash && versionHash !== 'latest') {
          nodeVersionResult = await this.db
            .select()
            .from(artifactNodeVersions)
            .where(
              and(
                eq(artifactNodeVersions.nodeId, nodeId),
                eq(artifactNodeVersions.commitHash, versionHash)
              )
            )
            .limit(1);
        } else {
          nodeVersionResult = await this.db
            .select()
            .from(artifactNodeVersions)
            .where(eq(artifactNodeVersions.nodeId, nodeId))
            .orderBy(desc(artifactNodeVersions.createdAt))
            .limit(1);
        }

        if (nodeVersionResult.length === 0) {
          return {
            success: false,
            error: { code: 'NOT_FOUND', message: 'Node version not found' },
          };
        }

        const nodeVersion = nodeVersionResult[0];

        // 解析内容
        let content: ArtifactNodeContent | undefined;
        if (nodeVersion.content) {
          try {
            content = JSON.parse(nodeVersion.content) as ArtifactNodeContent;
          } catch {
            // 忽略解析错误
          }
        }

        return {
          success: true,
          data: {
            id: node.id,
            type: node.type as ArtifactNodeType,
            name: node.name,
            external: false,
            version: {
              id: nodeVersion.id,
              commitHash: nodeVersion.commitHash,
              contentHash: nodeVersion.contentHash,
              message: nodeVersion.message,
              createdAt: nodeVersion.createdAt,
            },
            content,
          },
        };
      }

      // 检查是否是外部节点引用
      // 首先获取当前 artifact 的最新版本
      const artifactVersionResult = await this.db
        .select()
        .from(artifactVersions)
        .where(eq(artifactVersions.artifactId, artifactId))
        .orderBy(desc(artifactVersions.createdAt))
        .limit(1);

      if (artifactVersionResult.length === 0) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Artifact version not found' },
        };
      }

      const refResult = await this.db
        .select({
          ref: artifactNodeRefs,
          externalArtifact: artifacts,
          externalNode: artifactNodes,
          author: {
            id: user.id,
            username: user.username,
          },
        })
        .from(artifactNodeRefs)
        .innerJoin(artifacts, eq(artifactNodeRefs.externalArtifactId, artifacts.id))
        .innerJoin(user, eq(artifacts.authorId, user.id))
        .leftJoin(artifactNodes, eq(artifactNodeRefs.externalNodeId, artifactNodes.id))
        .where(and(
          eq(artifactNodeRefs.artifactVersionId, artifactVersionResult[0].id),
          eq(artifactNodeRefs.externalNodeId, nodeId)
        ))
        .limit(1);

      if (refResult.length === 0) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Node not found' },
        };
      }

      const ref = refResult[0];

      // 获取外部节点的版本信息
      const externalVersionResult = await this.db
        .select()
        .from(artifactNodeVersions)
        .where(eq(artifactNodeVersions.id, ref.ref.externalNodeVersionId))
        .limit(1);

      if (externalVersionResult.length === 0) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'External node version not found' },
        };
      }

      const externalVersion = externalVersionResult[0];

      // 解析内容
      let content: ArtifactNodeContent | undefined;
      if (externalVersion.content) {
        try {
          content = JSON.parse(externalVersion.content) as ArtifactNodeContent;
        } catch {
          // 忽略解析错误
        }
      }

      return {
        success: true,
        data: {
          id: nodeId,
          type: ref.externalNode?.type as ArtifactNodeType || 'PROMPT',
          name: ref.externalNode?.name ?? null,
          external: true,
          externalArtifact: {
            id: ref.externalArtifact.id,
            name: ref.externalArtifact.name,
            slug: ref.externalArtifact.slug,
            author: ref.author,
          },
          version: {
            id: externalVersion.id,
            commitHash: externalVersion.commitHash,
            contentHash: externalVersion.contentHash,
            message: externalVersion.message,
            createdAt: externalVersion.createdAt,
          },
          content,
        },
      };
    } catch (error) {
      console.error('Get node detail error:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      };
    }
  }

  // 获取 VFS 节点的 tar.gz 归档文件 R2 key
  async getVfsArchiveKey(
    artifactId: string,
    nodeId: string,
    version?: string
  ): Promise<ServiceResult<{ key: string }>> {
    try {
      // 获取版本信息以获取 commitHash
      const versionInfoResult = await this.getNodeVersionInfo(nodeId, version);
      if (!versionInfoResult.success) {
        return versionInfoResult;
      }

      const { commitHash } = versionInfoResult.data;
      const key = `${artifactId}/nodes/${nodeId}/${commitHash}/files.tar.gz`;
      
      return {
        success: true,
        data: { key },
      };
    } catch (error) {
      console.error('Get VFS archive key error:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get VFS archive key' },
      };
    }
  }

  // 获取节点版本信息（用于获取 commitHash）
  async getNodeVersionInfo(
    nodeId: string,
    versionHash?: string
  ): Promise<ServiceResult<{ commitHash: string; nodeType: ArtifactNodeType }>> {
    try {
      // 获取节点
      const nodeResult = await this.db
        .select()
        .from(artifactNodes)
        .where(eq(artifactNodes.id, nodeId))
        .limit(1);

      if (nodeResult.length === 0) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Node not found' },
        };
      }

      const node = nodeResult[0];

      // 获取版本
      let versionResult;
      if (versionHash && versionHash !== 'latest') {
        versionResult = await this.db
          .select()
          .from(artifactNodeVersions)
          .where(and(
            eq(artifactNodeVersions.nodeId, nodeId),
            eq(artifactNodeVersions.commitHash, versionHash)
          ))
          .limit(1);
      } else {
        versionResult = await this.db
          .select()
          .from(artifactNodeVersions)
          .where(eq(artifactNodeVersions.nodeId, nodeId))
          .orderBy(desc(artifactNodeVersions.createdAt))
          .limit(1);
      }

      if (versionResult.length === 0) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Node version not found' },
        };
      }

      return {
        success: true,
        data: {
          commitHash: versionResult[0].commitHash,
          nodeType: node.type as ArtifactNodeType,
        },
      };
    } catch (error) {
      console.error('Get node version info error:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      };
    }
  }

  // 创建节点
  async createNode(input: CreateNodeInput): Promise<ServiceResult<ArtifactNode>> {
    try {
      const newNode = {
        id: input.id,
        artifactId: input.artifactId,
        type: input.type,
        name: input.name ?? null,
        positionX: input.positionX ?? null,
        positionY: input.positionY ?? null,
        originalNodeId: input.originalNodeId ?? null,
        originalCommit: input.originalCommit ?? null,
      };

      await this.db.insert(artifactNodes).values(newNode);

      const result = await this.db
        .select()
        .from(artifactNodes)
        .where(eq(artifactNodes.id, input.id))
        .limit(1);

      return {
        success: true,
        data: result[0],
      };
    } catch (error) {
      console.error('Create node error:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      };
    }
  }

  // 创建节点版本（现在内容存储在数据库中）
  async createNodeVersion(input: CreateNodeVersionInput): Promise<ServiceResult<ArtifactNodeVersion>> {
    try {
      const versionId = crypto.randomUUID();
      const newVersion = {
        id: versionId,
        nodeId: input.nodeId,
        commitHash: input.commitHash,
        contentHash: input.contentHash,
        content: JSON.stringify(input.content),
        message: input.message ?? null,
      };

      await this.db.insert(artifactNodeVersions).values(newVersion);

      const result = await this.db
        .select()
        .from(artifactNodeVersions)
        .where(eq(artifactNodeVersions.id, versionId))
        .limit(1);

      return {
        success: true,
        data: result[0],
      };
    } catch (error) {
      console.error('Create node version error:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      };
    }
  }

  // 创建外部节点引用
  async createNodeRef(
    artifactVersionId: string,
    externalNodeId: string,
    externalArtifactId: string,
    externalNodeVersionId: string
  ): Promise<ServiceResult<void>> {
    try {
      await this.db.insert(artifactNodeRefs).values({
        id: crypto.randomUUID(),
        artifactVersionId,
        externalNodeId,
        externalArtifactId,
        externalNodeVersionId,
      });

      return { success: true, data: undefined };
    } catch (error) {
      console.error('Create node ref error:', error);
      return {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      };
    }
  }
}
