import { eq, and, desc } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Database } from '../client';
import { artifacts, artifactVersions } from '../schema/artifacts';
import { 
  artifactNodes, 
  artifactNodeVersions, 
  artifactNodeFiles, 
  artifactNodeRefs,
  type ArtifactNode,
  type ArtifactNodeVersion,
  type ArtifactNodeFile,
} from '../schema/nodes';
import { user } from '../schema/auth';
import { chunkArray } from '../utils';
import type { ServiceError, ServiceResult } from './user';
import type {
  ArtifactNodeSummary,
  ArtifactEdge,
  NodeVersionInfo,
  NodeFileInfo,
  ArtifactNodeType,
} from '@pubwiki/api';
import type { StoredEdge } from '../schema/artifacts';

// 重新导出类型
export type { ArtifactNodeSummary, ArtifactEdge, NodeVersionInfo, NodeFileInfo };

// 获取图结构响应
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

// 获取节点详情响应
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
  files?: NodeFileInfo[];
}

// 创建节点输入
export interface CreateNodeInput {
  id: string;
  artifactId: string;
  type: ArtifactNodeType;
  name?: string;
}

// 创建节点版本输入
export interface CreateNodeVersionInput {
  nodeId: string;
  commitHash: string;
  contentHash: string;
  message?: string;
  files: CreateNodeFileInput[];
}

// 创建节点文件输入
export interface CreateNodeFileInput {
  filepath: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  checksum?: string;
}

export class NodeService {
  constructor(private db: Database) {}

  // 获取 artifact 的图结构（节点和边）
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

      // 构建节点列表
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

        // 获取文件列表
        const filesResult = await this.db
          .select()
          .from(artifactNodeFiles)
          .where(eq(artifactNodeFiles.nodeVersionId, nodeVersion.id));

        const files: NodeFileInfo[] = filesResult.map((f) => ({
          filepath: f.filepath,
          filename: f.filename,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
        }));

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
            files,
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

      // 获取文件列表
      const filesResult = await this.db
        .select()
        .from(artifactNodeFiles)
        .where(eq(artifactNodeFiles.nodeVersionId, externalVersion.id));

      const files: NodeFileInfo[] = filesResult.map((f) => ({
        filepath: f.filepath,
        filename: f.filename,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
      }));

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
          files,
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

  // 获取节点文件记录
  async getNodeFile(
    artifactId: string,
    nodeId: string,
    filepath: string,
    versionHash?: string
  ): Promise<ServiceResult<{
    file: ArtifactNodeFile;
    r2Key: string;
  }>> {
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

      let nodeVersionId: string;
      let nodeVersion: ArtifactNodeVersion;

      if (nodeResult.length > 0) {
        // 内部节点
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
        nodeVersion = nodeVersionResult[0];
        nodeVersionId = nodeVersion.id;
      } else {
        // 外部节点引用
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
          .select()
          .from(artifactNodeRefs)
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

        nodeVersionId = refResult[0].externalNodeVersionId;
        
        // 获取版本信息
        const externalVersionResult = await this.db
          .select()
          .from(artifactNodeVersions)
          .where(eq(artifactNodeVersions.id, nodeVersionId))
          .limit(1);

        if (externalVersionResult.length === 0) {
          return {
            success: false,
            error: { code: 'NOT_FOUND', message: 'External node version not found' },
          };
        }
        nodeVersion = externalVersionResult[0];
      }

      // 获取文件记录
      const fileResult = await this.db
        .select()
        .from(artifactNodeFiles)
        .where(and(
          eq(artifactNodeFiles.nodeVersionId, nodeVersionId),
          eq(artifactNodeFiles.filepath, filepath)
        ))
        .limit(1);

      if (fileResult.length === 0) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'File not found' },
        };
      }

      // 构建 R2 key
      // 格式: /{artifact_id}/nodes/{node_id}/{version_hash}/{filepath}
      const r2Key = `${artifactId}/nodes/${nodeId}/${nodeVersion.commitHash}/${filepath}`;

      return {
        success: true,
        data: {
          file: fileResult[0],
          r2Key,
        },
      };
    } catch (error) {
      console.error('Get node file error:', error);
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

  // 创建节点版本（使用 batch 保证原子性）
  async createNodeVersion(input: CreateNodeVersionInput): Promise<ServiceResult<ArtifactNodeVersion>> {
    try {
      const versionId = crypto.randomUUID();
      const newVersion = {
        id: versionId,
        nodeId: input.nodeId,
        commitHash: input.commitHash,
        contentHash: input.contentHash,
        message: input.message ?? null,
      };

      // 收集所有批量操作的语句
      const batchOperations: BatchItem<"sqlite">[] = [];
      
      batchOperations.push(this.db.insert(artifactNodeVersions).values(newVersion));

      // 创建文件记录（分批插入以遵守 SQLite 参数限制）
      if (input.files.length > 0) {
        const fileRecords = input.files.map((f) => ({
          id: crypto.randomUUID(),
          nodeVersionId: versionId,
          filepath: f.filepath,
          filename: f.filename,
          mimeType: f.mimeType ?? null,
          sizeBytes: f.sizeBytes ?? null,
          checksum: f.checksum ?? null,
        }));

        // 每行 7 个字段，分批插入
        const chunks = chunkArray(fileRecords, 7);
        for (const chunk of chunks) {
          batchOperations.push(this.db.insert(artifactNodeFiles).values(chunk));
        }
      }

      // 使用 batch 执行所有操作（D1 的 batch 是事务性的）
      await this.db.batch(batchOperations as any);

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
