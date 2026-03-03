<script lang="ts">
	/**
	 * Play Page - Consumer-facing gameplay interface
	 * 
	 * Creates a hidden Studio project from the artifact and runs it in fullscreen mode.
	 * - No flow graph exposed
	 * - Loading progress bar
	 * - Fullscreen sandbox display
	 * - Checkpoint loading based on URL params
	 */
	import { onMount, onDestroy, untrack } from 'svelte';
	import type { PageData } from './$types';
	import { createApiClient } from '@pubwiki/api/client';
	import { API_BASE_URL } from '$lib/config';
	import { 
		nodeStore, 
		layoutStore, 
		saveEdges,
		getEdges,
		getProject, 
		saveProject
	} from '$lib/persistence';
	import { convertArtifactToStudioGraph } from '$lib/io/import';
	import { getNodeVfs, type NodeVfs } from '$lib/vfs';
	import { getNodeRDFStore, closeNodeRDFStore, type RDFStore } from '$lib/rdf';
	import { createLoaderServices } from '$lib/sandbox';
	import { detectProject, type ProjectConfig } from '@pubwiki/bundler';
	import { 
		initializeLoader, 
		destroyLoader 
	} from '$components/nodes/loader/controller.svelte';
	import { HandleId } from '$lib/graph';
	import type { LoaderNodeData, LoaderContent, VFSContent } from '$lib/types';
	import { 
		createSandboxConnection, 
		type SandboxConnection, 
		type ConsoleLogEntry
	} from '@pubwiki/sandbox-host';
	import type { 
		SandboxNodeData, 
		VFSNodeData, 
		StateNodeData,
		StudioNodeData 
	} from '$lib/types';
	import { StateContent } from '$lib/types';
	import type { Edge } from '@xyflow/svelte';
	import { useAuth } from '@pubwiki/ui/stores';
	import type { GetArtifactGraphResponse, ArtifactEdge } from '@pubwiki/api';
	import PlayLoader from './PlayLoader.svelte';
	import PlayError from './PlayError.svelte';

	// ============================================================================
	// API Client
	// ============================================================================

	const apiClient = createApiClient(API_BASE_URL);
	const auth = useAuth();

	// ============================================================================
	// Page Data
	// ============================================================================

	let { data }: { data: PageData } = $props();

	// ============================================================================
	// Loading State
	// ============================================================================

	interface LoadingState {
		stage: 'init' | 'fetching-graph' | 'creating-project' | 'loading-vfs' | 'loading-state' | 'starting-sandbox' | 'ready' | 'error';
		progress: number;
		message: string;
		error?: string;
	}

	let loadingState = $state<LoadingState>({
		stage: 'init',
		progress: 0,
		message: 'Initializing...'
	});

	// ============================================================================
	// Sandbox State
	// ============================================================================

	let iframeRef = $state<HTMLIFrameElement | null>(null);
	let sandboxConnection = $state<SandboxConnection | null>(null);
	let vfs = $state<NodeVfs | null>(null);
	let rdfStore = $state<RDFStore | null>(null);
	let projectConfig = $state<ProjectConfig | null>(null);
	let sandboxOrigin = $state<string>('');
	let entryFile = $state<string>('index.ts');
	let consoleLogs = $state<ConsoleLogEntry[]>([]);
	let iframeSrc = $state<string>('');  // Controlled separately to avoid timing issues
	
	// Node IDs found from the graph
	let sandboxNodeId = $state<string | null>(null);
	let vfsNodeId = $state<string | null>(null);
	let loaderNodeIds = $state<string[]>([]);
	let stateNodeId = $state<string | null>(null);
	
	// Project ID for the hidden project
	let projectId = $derived(`play-${data.artifactId}`);

	// ============================================================================
	// User Info (to be passed to sandbox)
	// ============================================================================

	interface UserInfo {
		isLoggedIn: boolean;
		userId: string | null;
		username: string | null;
		/** The save commit hash loaded from URL param */
		sourceSaveCommit: string | null;
		/** User's own save commit (if any) */
		userSaveCommit: string | null;
	}

	let userInfo = $state<UserInfo>({
		isLoggedIn: false,
		userId: null,
		username: null,
		sourceSaveCommit: null,
		userSaveCommit: null
	});

	// ============================================================================
	// Initialization
	// ============================================================================

	async function initialize() {
		try {
			// Validate required params
			if (!data.sandboxNodeId) {
				throw new Error('Missing sandbox_id parameter');
			}

			// Stage 1: Fetch artifact graph
			loadingState = {
				stage: 'fetching-graph',
				progress: 10,
				message: 'Fetching game data...'
			};

			const { data: graphData, error: graphError } = await apiClient.GET('/artifacts/{artifactId}/graph', {
				params: {
					path: { artifactId: data.artifactId },
					query: { version: 'latest' }
				}
			});

			if (graphError || !graphData) {
				throw new Error('Failed to fetch artifact graph');
			}

			// Stage 2: Create or load hidden project
			loadingState = {
				stage: 'creating-project',
				progress: 25,
				message: 'Preparing game environment...'
			};

			const existingProject = await getProject(projectId);
			
			if (!existingProject) {
				// Find original stateNodeId from artifact edges BEFORE remap
				const originalStateNodeId = findOriginalStateNodeId(
					(graphData as GetArtifactGraphResponse).edges,
					data.sandboxNodeId!
				);
				if (!originalStateNodeId) {
					throw new Error('Could not find State node connected to Sandbox in artifact graph');
				}

				// Create new hidden project
				await saveProject({
					id: projectId,
					name: `Play: ${data.artifactId.substring(0, 8)}`,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					isDraft: false,
					artifactId: data.artifactId,
					isHidden: true,
					playSandboxNodeId: data.sandboxNodeId,
					playStateNodeId: originalStateNodeId
				});

				// Convert artifact to studio nodes
				const { nodes, edges } = await convertArtifactToStudioGraph(
					graphData as GetArtifactGraphResponse,
					data.artifactId,
					projectId
				);

				// Initialize stores
				await nodeStore.init(projectId);
				await layoutStore.init(projectId);

				// Save nodes and edges
				for (const node of nodes) {
					nodeStore.set(node.id, node.data as StudioNodeData);
					layoutStore.add(node.id, node.position.x, node.position.y);
				}
				await saveEdges(edges, projectId);
				await nodeStore.flush();
				await layoutStore.flush();

				console.log('[Play] Created hidden project:', projectId);
			} else {
				// Load existing project
				await nodeStore.init(projectId);
				await layoutStore.init(projectId);
				console.log('[Play] Loaded existing project:', projectId);
			}

			// Find nodes from edges (this sets stateNodeId to remapped ID)
			const edges = await getEdges(projectId);
			findNodes(edges);

			if (!stateNodeId || !sandboxNodeId || !vfsNodeId) {
				throw new Error('Could not find required State, Sandbox or VFS nodes. State node may not exist in artifact.');
			}

			// Stage 3: Load VFS
			loadingState = {
				stage: 'loading-vfs',
				progress: 45,
				message: 'Loading game files...'
			};

			const vfsNodeData = nodeStore.get(vfsNodeId) as VFSNodeData | undefined;
			if (!vfsNodeData) {
				throw new Error('VFS node data not found');
			}

			vfs = await getNodeVfs(vfsNodeData.content.projectId, vfsNodeId);

			// Detect project config
			const config = await detectProject('/tsconfig.json', vfs);
			if (!config || !config.isBuildable) {
				throw new Error('Invalid project configuration');
			}
			projectConfig = config;

			// Get sandbox node data
			const sandboxNodeData = nodeStore.get(sandboxNodeId) as SandboxNodeData | undefined;
			if (!sandboxNodeData) {
				throw new Error('Sandbox node data not found');
			}
			sandboxOrigin = process.env.PUBLIC_SANDBOX_SITE_URL ?? "https://sandbox.soyo.mu";
			entryFile = sandboxNodeData.content.entryFile;

			// Stage 4: Load state (RDF store)
			loadingState = {
				stage: 'loading-state',
				progress: 60,
				message: 'Loading game state...'
			};

			// stateNodeId was already set by findNodes() to the remapped ID
			if (!stateNodeId) {
				throw new Error('State node ID not found after node discovery');
			}
			rdfStore = await getNodeRDFStore(stateNodeId);

			// Load save data if save commit is provided
			if (data.saveCommit) {
				await loadCheckpointData();
			}

			// Update user info
			userInfo = {
				isLoggedIn: auth.isAuthenticated,
				userId: auth.user?.id ?? null,
				username: auth.user?.displayName ?? auth.user?.username ?? null,
				sourceSaveCommit: data.saveCommit,
				userSaveCommit: null // TODO: Create user save if logged in
			};

			// Stage 4.5: Initialize Loader nodes
			// This must happen BEFORE Stage 5 so that services are registered
			loadingState = {
				stage: 'loading-state',  // Reuse loading-state stage
				progress: 70,
				message: 'Loading services...'
			};
			await initializeLoaders(edges);

			// Stage 5: Start sandbox
			loadingState = {
				stage: 'starting-sandbox',
				progress: 80,
				message: 'Starting game...'
			};

			console.log('[Play] Stage 5: Starting sandbox...');
			console.log('[Play] sandboxOrigin:', sandboxOrigin);
			console.log('[Play] entryFile:', entryFile);
			console.log('[Play] loaderNodeIds:', loaderNodeIds);
			console.log('[Play] vfs:', vfs);
			console.log('[Play] projectConfig:', projectConfig);

			// Wait for iframe to be mounted
			await new Promise(resolve => setTimeout(resolve, 100));
			console.log('[Play] After 100ms wait, iframeRef:', iframeRef);

			if (!iframeRef) {
				throw new Error('Sandbox iframe not ready');
			}

			// Create custom services from loaders
			console.log('[Play] Creating loader services for', loaderNodeIds.length, 'loaders...');
			const customServices = loaderNodeIds.length > 0 ? await createLoaderServices(loaderNodeIds) : undefined;
			console.log('[Play] customServices created:', customServices?.size ?? 0, 'services');

			// Create sandbox connection
			// Note: userInfo is passed via iframe.name, not through RPC
			console.log('[Play] Creating sandbox connection...');
			sandboxConnection = createSandboxConnection({
				iframe: iframeRef,
				basePath: '/',
				projectConfig,
				targetOrigin: sandboxOrigin,
				entryFile,
				vfs,
				customServices,
				onLog: (entry) => {
					consoleLogs = [...consoleLogs, entry];
				}
			});

			// Now set iframe src to trigger sandbox loading
			// This must be after createSandboxConnection to avoid missing SANDBOX_READY message
			console.log('[Play] Setting iframe src to trigger sandbox loading...');
			iframeSrc = `${sandboxOrigin}/__sandbox.html`;

			console.log('[Play] Waiting for sandbox ready...');
			const success = await sandboxConnection.waitForReady();
			console.log('[Play] waitForReady returned:', success);
			if (!success) {
				throw new Error('Failed to initialize sandbox');
			}

			loadingState = {
				stage: 'ready',
				progress: 100,
				message: 'Ready!'
			};

			console.log('[Play] Sandbox started successfully');

		} catch (error) {
			console.error('[Play] Initialization failed:', error);
			loadingState = {
				stage: 'error',
				progress: 0,
				message: 'Failed to load',
				error: error instanceof Error ? error.message : 'Unknown error'
			};
		}
	}

	/**
	 * Find original stateNodeId from artifact edges BEFORE ID remap
	 * URL params contain original artifact node IDs
	 * Connection path: State → Loader (loader-state) → Sandbox (service-input)
	 */
	function findOriginalStateNodeId(edges: ArtifactEdge[], originalSandboxNodeId: string): string | null {
		// Step 1: Find Loaders connected to Sandbox via service-input
		const loaderNodeIds: string[] = [];
		for (const edge of edges) {
			if (edge.target === originalSandboxNodeId && edge.targetHandle === 'service-input') {
				loaderNodeIds.push(edge.source);
			}
		}
		
		// Step 2: Find State connected to any Loader via loader-state
		for (const loaderId of loaderNodeIds) {
			for (const edge of edges) {
				if (edge.target === loaderId && edge.targetHandle === 'loader-state') {
					return edge.source;  // Return original stateNodeId
				}
			}
		}
		return null;
	}

	/**
	 * Verify that a node exists in the store
	 * In the new architecture, node IDs are preserved during import,
	 * so we just need to verify the node exists.
	 */
	function verifyNodeExists(nodeId: string, expectedType: string): boolean {
		const nodeData = nodeStore.get(nodeId);
		return nodeData?.type === expectedType;
	}

	/**
	 * Find connected nodes from edges
	 * Node IDs are preserved during import, so we use them directly
	 */
	function findNodes(edges: Edge[]) {
		const targetSandboxNodeId = data.sandboxNodeId;
		if (!targetSandboxNodeId) return;

		// In the new architecture, node IDs are preserved during import
		// So we use the ID directly from the URL params
		if (!verifyNodeExists(targetSandboxNodeId, 'SANDBOX')) {
			console.error('[Play] Sandbox node not found:', targetSandboxNodeId);
			return;
		}
		sandboxNodeId = targetSandboxNodeId;

		// Find Loaders connected to Sandbox via service-input
		const loaders: string[] = [];
		for (const edge of edges) {
			if (edge.target === sandboxNodeId && edge.targetHandle === 'service-input') {
				const nodeData = nodeStore.get(edge.source);
				if (nodeData?.type === 'LOADER') {
					loaders.push(edge.source);
				}
			}
		}
		loaderNodeIds = loaders;

		// Find State connected to any Loader via loader-state
		for (const loaderId of loaderNodeIds) {
			for (const edge of edges) {
				if (edge.target === loaderId && edge.targetHandle === 'loader-state') {
					const nodeData = nodeStore.get(edge.source);
					if (nodeData?.type === 'STATE') {
						stateNodeId = edge.source;
						break;
					}
				}
			}
			if (stateNodeId) break;
		}

		if (!stateNodeId) {
			console.error('[Play] Could not find State node connected to Loader');
			return;
		}

		// Find VFS connected to Sandbox via vfs-input
		for (const edge of edges) {
			if (edge.target === sandboxNodeId && edge.targetHandle === 'vfs-input') {
				const nodeData = nodeStore.get(edge.source);
				if (nodeData?.type === 'VFS') {
					vfsNodeId = edge.source;
					break;
				}
			}
		}

		console.log('[Play] Found nodes:', { 
			sandboxNodeId,
			stateNodeId,
			vfsNodeId, 
			loaderNodeIds 
		});
	}

	/**
	 * Initialize all Loader nodes so their services become available
	 * This mimics what LoaderNode.svelte does during normal studio operation.
	 */
	async function initializeLoaders(edges: Edge[]) {
		if (loaderNodeIds.length === 0) {
			console.log('[Play] No loader nodes to initialize');
			return;
		}

		console.log('[Play] Initializing', loaderNodeIds.length, 'loader nodes...');

		for (const loaderId of loaderNodeIds) {
			try {
				// Find backend VFS connected to Loader via loader-backend handle
				let backendVfsNodeId: string | null = null;
				for (const edge of edges) {
					if (edge.target === loaderId && edge.targetHandle === HandleId.LOADER_BACKEND) {
						const sourceData = nodeStore.get(edge.source);
						if (sourceData?.type === 'VFS') {
							backendVfsNodeId = edge.source;
							break;
						}
					}
				}

				if (!backendVfsNodeId) {
					console.warn(`[Play] Loader ${loaderId} has no backend VFS connected`);
					continue;
				}

				// Get backend VFS instance
				const backendVfsData = nodeStore.get(backendVfsNodeId);
				if (!backendVfsData || backendVfsData.type !== 'VFS') {
					console.warn(`[Play] Backend VFS node data not found for loader ${loaderId}`);
					continue;
				}
				const backendVfsContent = backendVfsData.content as VFSContent;
				const backendVfs = await getNodeVfs(backendVfsContent.projectId, backendVfsNodeId);

				// Find mounted asset VFS nodes - use VFS mounts configuration
				// The backend VFS's mounts array defines which VFS nodes are mounted and where
				const assetMounts = new Map<string, Awaited<ReturnType<typeof getNodeVfs>>>();
				
				// New approach: Use VFS node's mounts configuration
				const vfsMounts = backendVfsContent.mounts || [];
				for (const mount of vfsMounts) {
					const sourceData = nodeStore.get(mount.sourceNodeId);
					if (sourceData?.type === 'VFS') {
						const vfsContent = sourceData.content as VFSContent;
						const mountVfs = await getNodeVfs(vfsContent.projectId, mount.sourceNodeId);
						assetMounts.set(mount.mountPath, mountVfs);
					}
				}

				// Find State node connected to Loader via loader-state handle
				let loaderStateNodeId: string | null = null;
				for (const edge of edges) {
					if (edge.target === loaderId && edge.targetHandle === HandleId.LOADER_STATE) {
						const sourceData = nodeStore.get(edge.source);
						if (sourceData?.type === 'STATE') {
							loaderStateNodeId = edge.source;
							break;
						}
					}
				}

				// Get RDF store for State node (can use existing rdfStore if same state node)
				const loaderRdfStore = loaderStateNodeId 
					? (loaderStateNodeId === stateNodeId ? rdfStore : await getNodeRDFStore(loaderStateNodeId))
					: undefined;

				// Initialize loader (no LLM config in play mode)
				const result = await initializeLoader(
					loaderId,
					backendVfs,
					assetMounts,
					loaderRdfStore ?? undefined,
					undefined,  // No LLM config in play mode
					undefined   // No pubwiki context in play mode
				);

				if (result.success) {
					console.log(`[Play] Loader ${loaderId} initialized with services:`, result.services);
				} else {
					console.warn(`[Play] Loader ${loaderId} initialization failed:`, result.error);
				}
			} catch (error) {
				console.error(`[Play] Error initializing loader ${loaderId}:`, error);
			}
		}

		console.log('[Play] Loader initialization complete');
	}

	/**
	 * Load save data from cloud using the new Save API.
	 * 
	 * Uses GET /saves/{commit}/data to download save data as quads.
	 * The save commit is provided via URL parameter ?save={commit}
	 */
	async function loadCheckpointData() {
		if (!data.saveCommit || !rdfStore) return;

		try {
			console.log('[Play] Loading save data for commit:', data.saveCommit);

			// Download save data using new Save API
			const response = await fetch(`${API_BASE_URL}/saves/${data.saveCommit}/data`, {
				credentials: 'include'
			});

			if (!response.ok) {
				console.warn('[Play] Failed to download save data:', response.status);
				return;
			}

			// Parse quads from response
			const quadsJson = await response.text();
			const apiQuads = JSON.parse(quadsJson);
			const { toRdfQuad } = await import('@pubwiki/rdfstore');
			const rdfQuads = apiQuads.map(toRdfQuad);

			// Replace local store contents
			await rdfStore.clear();
			await rdfStore.batchInsert(rdfQuads);
			console.log('[Play] Imported save data:', rdfQuads.length, 'quads');
		} catch (error) {
			console.error('[Play] Failed to load save:', error);
		}
	}

	// ============================================================================
	// Lifecycle
	// ============================================================================

	onMount(() => {
		initialize();
	});

	onDestroy(() => {
		if (sandboxConnection) {
			sandboxConnection.disconnect();
		}
		if (stateNodeId) {
			closeNodeRDFStore(stateNodeId);
		}
		// Destroy all initialized loaders
		for (const loaderId of loaderNodeIds) {
			destroyLoader(loaderId);
		}
	});

	// ============================================================================
	// Error Retry
	// ============================================================================

	function handleRetry() {
		// Reset iframeSrc to allow fresh reload
		iframeSrc = '';
		loadingState = {
			stage: 'init',
			progress: 0,
			message: 'Retrying...'
		};
		initialize();
	}
</script>

<svelte:head>
	<title>Play - {data.artifactId.substring(0, 8)}</title>
</svelte:head>

<div class="fixed inset-0 bg-black">
	{#if loadingState.stage === 'error'}
		<PlayError 
			message={loadingState.error ?? 'Unknown error'} 
			onRetry={handleRetry} 
		/>
	{:else if loadingState.stage !== 'ready'}
		<PlayLoader {loadingState} />
	{/if}

	<!-- Sandbox iframe (always rendered but hidden until ready) -->
	<!-- userInfo is passed via iframe name attribute as JSON -->
	<!-- iframeSrc is set after createSandboxConnection to avoid missing SANDBOX_READY message -->
	<iframe
		bind:this={iframeRef}
		src={iframeSrc}
		name={JSON.stringify(userInfo)}
		class="w-full h-full border-0"
		class:opacity-0={loadingState.stage !== 'ready'}
		class:pointer-events-none={loadingState.stage !== 'ready'}
		sandbox="allow-downloads allow-scripts allow-same-origin allow-forms allow-popups"
		allow="fullscreen; clipboard-read; clipboard-write"
		title="Game"
	></iframe>
</div>

<style>
	iframe {
		transition: opacity 0.3s ease-in-out;
	}
</style>
