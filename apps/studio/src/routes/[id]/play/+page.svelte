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
	import { browser } from '$app/environment';
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
	import { getNodeVfs, preInitializeZenFS, type VersionedVfs } from '$lib/vfs';
	import { getNodeRDFStore, closeNodeRDFStore, type RDFStore } from '$lib/rdf';
	import { createLoaderServices } from '$lib/sandbox';
	import { detectProject, type ProjectConfig } from '@pubwiki/bundler';
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
	// Pre-initialize ZenFS
	// ============================================================================
	
	if (browser) {
		preInitializeZenFS();
	}

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
	let vfs = $state<VersionedVfs | null>(null);
	let rdfStore = $state<RDFStore | null>(null);
	let projectConfig = $state<ProjectConfig | null>(null);
	let sandboxOrigin = $state<string>('');
	let entryFile = $state<string>('index.ts');
	let consoleLogs = $state<ConsoleLogEntry[]>([]);
	
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
		sourceSaveId: string | null;
		sourceCheckpointId: string | null;
		userSaveId: string | null;
		userCheckpointId: string | null;
	}

	let userInfo = $state<UserInfo>({
		isLoggedIn: false,
		userId: null,
		username: null,
		sourceSaveId: null,
		sourceCheckpointId: null,
		userSaveId: null,
		userCheckpointId: null
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
			sandboxOrigin = sandboxNodeData.content.sandboxOrigin;
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

			// Load checkpoint data if saveId is provided
			if (data.saveId) {
				await loadCheckpointData();
			}

			// Update user info
			userInfo = {
				isLoggedIn: auth.isAuthenticated,
				userId: auth.user?.id ?? null,
				username: auth.user?.displayName ?? auth.user?.username ?? null,
				sourceSaveId: data.saveId,
				sourceCheckpointId: data.checkpointId,
				userSaveId: null, // TODO: Create user save if logged in
				userCheckpointId: null
			};

			// Stage 5: Start sandbox
			loadingState = {
				stage: 'starting-sandbox',
				progress: 80,
				message: 'Starting game...'
			};

			// Wait for iframe to be mounted
			await new Promise(resolve => setTimeout(resolve, 100));

			if (!iframeRef) {
				throw new Error('Sandbox iframe not ready');
			}

			// Create custom services from loaders
			const customServices = loaderNodeIds.length > 0 ? await createLoaderServices(loaderNodeIds) : undefined;

			// Create sandbox connection
			// Note: userInfo is passed via iframe.name, not through RPC
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

			const success = await sandboxConnection.waitForReady();
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
	 */
	function findOriginalStateNodeId(edges: ArtifactEdge[], originalSandboxNodeId: string): string | null {
		for (const edge of edges) {
			if (edge.source === originalSandboxNodeId && edge.targetHandle === 'state-input') {
				return edge.target;  // Return original stateNodeId
			}
		}
		return null;
	}

	/**
	 * Find the remapped state node ID from originalRef
	 * After import, all node IDs are remapped. We need to find the new ID via originalRef.
	 */
	function findRemappedStateNodeId(originalStateNodeId: string): string | null {
		// Iterate through all nodes to find the one with matching originalRef
		const allNodeIds = nodeStore.getAllIds();
		for (const nodeId of allNodeIds) {
			const nodeData = nodeStore.get(nodeId);
			if (nodeData?.type === 'STATE' && nodeData.originalRef?.nodeId === originalStateNodeId) {
				return nodeId;
			}
		}
		return null;
	}

	/**
	 * Find the remapped sandbox node ID from originalRef
	 */
	function findRemappedSandboxNodeId(originalSandboxNodeId: string): string | null {
		const allNodeIds = nodeStore.getAllIds();
		for (const nodeId of allNodeIds) {
			const nodeData = nodeStore.get(nodeId);
			if (nodeData?.type === 'SANDBOX' && nodeData.originalRef?.nodeId === originalSandboxNodeId) {
				return nodeId;
			}
		}
		return null;
	}

	/**
	 * Find connected nodes from edges
	 * Uses originalRef to map from original artifact IDs to remapped IDs
	 */
	function findNodes(edges: Edge[]) {
		const originalSandboxNodeId = data.sandboxNodeId;
		if (!originalSandboxNodeId) return;

		// Find the remapped sandbox node ID
		const remappedSandboxId = findRemappedSandboxNodeId(originalSandboxNodeId);
		if (!remappedSandboxId) {
			console.error('[Play] Could not find remapped sandbox node for original ID:', originalSandboxNodeId);
			return;
		}
		sandboxNodeId = remappedSandboxId;

		// Find State connected to Sandbox via state-input
		for (const edge of edges) {
			if (edge.source === remappedSandboxId && edge.targetHandle === 'state-input') {
				const nodeData = nodeStore.get(edge.target);
				if (nodeData?.type === 'STATE') {
					stateNodeId = edge.target;
					break;
				}
			}
		}

		if (!stateNodeId) {
			console.error('[Play] Could not find State node connected to Sandbox');
			return;
		}

		// Find VFS connected to Sandbox via vfs-input
		for (const edge of edges) {
			if (edge.target === remappedSandboxId && edge.targetHandle === 'vfs-input') {
				const nodeData = nodeStore.get(edge.source);
				if (nodeData?.type === 'VFS') {
					vfsNodeId = edge.source;
					break;
				}
			}
		}

		// Find Loaders connected to Sandbox via service-input
		const loaders: string[] = [];
		for (const edge of edges) {
			if (edge.target === remappedSandboxId && edge.targetHandle === 'service-input') {
				const nodeData = nodeStore.get(edge.source);
				if (nodeData?.type === 'LOADER') {
					loaders.push(edge.source);
				}
			}
		}
		loaderNodeIds = loaders;

		console.log('[Play] Found nodes:', { 
			originalSandboxNodeId,
			remappedSandboxId,
			stateNodeId,
			vfsNodeId, 
			loaderNodeIds 
		});
	}

	/**
	 * Load checkpoint data from cloud
	 */
	async function loadCheckpointData() {
		if (!data.saveId || !rdfStore) return;

		try {
			// First get checkpoints to find the right ref
			const { data: checkpointsData } = await apiClient.GET('/saves/{saveId}/checkpoints', {
				params: { path: { saveId: data.saveId } }
			});

			if (!checkpointsData?.checkpoints?.length) {
				console.log('[Play] No checkpoints found, starting fresh');
				return;
			}

			// Find target checkpoint
			let targetRef: string;
			if (data.checkpointId) {
				const checkpoint = checkpointsData.checkpoints.find(cp => cp.id === data.checkpointId);
				if (checkpoint) {
					targetRef = checkpoint.ref;
				} else {
					// Fallback to latest
					targetRef = checkpointsData.checkpoints[0].ref;
				}
			} else {
				// Use latest checkpoint
				targetRef = checkpointsData.checkpoints[0].ref;
			}

			// Export data at ref
			const { data: exportData, error: exportError } = await apiClient.GET('/saves/{saveId}/export/{ref}', {
				params: { path: { saveId: data.saveId, ref: targetRef } }
			});

			if (exportError || !exportData) {
				console.warn('[Play] Failed to export checkpoint data:', exportError);
				return;
			}

			// Import the N-Quads data into local RDF store
			if (exportData.data) {
				await rdfStore.replaceWithImport(exportData.data, { format: 'nquads' });
				console.log('[Play] Imported checkpoint data:', exportData.quadCount, 'quads');
			}

		} catch (error) {
			console.error('[Play] Failed to load checkpoint:', error);
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
	});

	// ============================================================================
	// Sandbox URL
	// ============================================================================

	const sandboxUrl = $derived(sandboxOrigin ? `${sandboxOrigin}/__sandbox.html` : '');

	// ============================================================================
	// Error Retry
	// ============================================================================

	function handleRetry() {
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
	<iframe
		bind:this={iframeRef}
		src={sandboxUrl}
		name={JSON.stringify(userInfo)}
		class="w-full h-full border-0"
		class:opacity-0={loadingState.stage !== 'ready'}
		class:pointer-events-none={loadingState.stage !== 'ready'}
		allow="fullscreen"
		title="Game"
	></iframe>
</div>

<style>
	iframe {
		transition: opacity 0.3s ease-in-out;
	}
</style>
