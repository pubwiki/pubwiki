/**
 * PubWiki Module Factory
 * 
 * Creates a JS module definition for PubWiki API access in Lua/TypeScript backends.
 * The module exposes:
 * - pubwiki.publish(metadata) -> {success: bool, artifactId?: string, error?: string}
 * - pubwiki.uploadArticle(data) -> {success: bool, articleId?: string, error?: string}
 * 
 * Each method requests user confirmation before executing API calls.
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { FlowNodeData } from '$lib/types/flow';
import type { JsModuleDefinition } from '$lib/loader';
import { API_BASE_URL } from '$lib/config';
import { publishArtifact, type PublishMetadata } from '$lib/io/publish';
import { requestConfirmation, type ConfirmationType } from '$lib/state/pubwiki-confirm.svelte';
import PublishForm from '$lib/components/pubwiki/PublishForm.svelte';
import UploadArticleForm from '$lib/components/pubwiki/UploadArticleForm.svelte';

// ============================================================================
// Types
// ============================================================================

/**
 * Context for PubWiki module operations
 */
export interface PubWikiModuleContext {
	/** Current project ID */
	projectId: string;
	/** Function to get current flow nodes */
	getNodes: () => Node<FlowNodeData>[];
	/** Function to get current flow edges */
	getEdges: () => Edge[];
	/** API base URL */
	apiBaseUrl: string;
}

/**
 * Publish metadata from Lua/TS script
 */
interface PublishInput {
	name: string;
	slug: string;
	description?: string;
	version?: string;
	visibility?: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
	tags?: string[];
	homepage?: string;
}

/**
 * Upload article data from Lua/TS script
 */
interface UploadArticleInput {
	articleId?: string;
	title: string;
	sandboxNodeId: string;
	content: unknown[];
	visibility?: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
}

/**
 * Result of PubWiki operations
 */
interface PubWikiResult {
	success: boolean;
	artifactId?: string;
	articleId?: string;
	error?: string;
}

// ============================================================================
// Module Factory
// ============================================================================

/**
 * Create a JS module definition for PubWiki API access
 * 
 * @param context - Context containing project info and flow accessors
 * @returns JsModuleDefinition for registerJsModule
 */
export function createPubWikiModule(context: PubWikiModuleContext): JsModuleDefinition {
	return {
		/**
		 * Publish current project as an artifact
		 */
		async publish(metadata: PublishInput): Promise<PubWikiResult> {
			// Build initial values for confirmation dialog
			const initialValues = {
				name: metadata.name || '',
				slug: metadata.slug || '',
				description: metadata.description || '',
				version: metadata.version || '1.0.0',
				visibility: metadata.visibility || 'PUBLIC',
				homepage: metadata.homepage || ''
			};

			// Request user confirmation with editable form
			const editedValues = await requestConfirmation('publish', PublishForm, initialValues);

			if (editedValues === null) {
				return {
					success: false,
					error: 'User cancelled the operation'
				};
			}

			// Build final metadata from user-edited values
			const finalMetadata: PublishMetadata = {
				artifactId: crypto.randomUUID(),
				type: 'GAME', // Default type for Loader-based projects
				name: editedValues.name as string,
				slug: editedValues.slug as string,
				description: (editedValues.description as string) || '',
				version: (editedValues.version as string) || '1.0.0',
				visibility: (editedValues.visibility as 'PUBLIC' | 'PRIVATE' | 'UNLISTED') || 'PUBLIC',
				tags: metadata.tags || [],
				homepage: (editedValues.homepage as string) || undefined
			};

			try {
				// Get current flow state
				const nodes = context.getNodes();
				const edges = context.getEdges();

				// Use existing publishArtifact function
				const result = await publishArtifact(finalMetadata, nodes, edges);

				return {
					success: result.success,
					artifactId: result.artifactId,
					error: result.error
				};
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err)
				};
			}
		},

		/**
		 * Upload an article
		 */
		async uploadArticle(data: UploadArticleInput): Promise<PubWikiResult> {
			// Build initial values for confirmation dialog
			const initialValues = {
				title: data.title || '',
				sandboxNodeId: data.sandboxNodeId || '',
				visibility: data.visibility || 'PUBLIC'
			};

			// Request user confirmation with editable form
			const editedValues = await requestConfirmation('uploadArticle', UploadArticleForm, initialValues);

			if (editedValues === null) {
				return {
					success: false,
					error: 'User cancelled the operation'
				};
			}

			// Build final data from user-edited values
			const articleId = data.articleId || crypto.randomUUID();
			const finalData = {
				title: editedValues.title as string,
				sandboxNodeId: editedValues.sandboxNodeId as string,
				content: data.content,
				visibility: (editedValues.visibility as 'PUBLIC' | 'PRIVATE' | 'UNLISTED') || 'PUBLIC'
			};

			try {
				const response = await fetch(`${context.apiBaseUrl}/articles/${articleId}`, {
					method: 'PUT',
					credentials: 'include',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify(finalData)
				});

				if (!response.ok) {
					const errorData = await response.json().catch(() => ({}));
					return {
						success: false,
						error: errorData.error || `HTTP ${response.status}`
					};
				}

				const result = await response.json();
				return {
					success: true,
					articleId: result.id || articleId
				};
			} catch (err) {
				return {
					success: false,
					error: err instanceof Error ? err.message : String(err)
				};
			}
		}
	};
}

/**
 * Create PubWiki module context from flow state getters
 */
export function createPubWikiContext(
	projectId: string,
	getNodes: () => Node<FlowNodeData>[],
	getEdges: () => Edge[]
): PubWikiModuleContext {
	return {
		projectId,
		getNodes,
		getEdges,
		apiBaseUrl: API_BASE_URL
	};
}
