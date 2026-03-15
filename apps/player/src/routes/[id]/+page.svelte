<script lang="ts">
	/**
	 * Player Play Page
	 *
	 * Standalone play page using flow-core/runtime directly.
	 * No Studio dependencies — uses Player's own VFS, RDF, and loader infrastructure.
	 *
	 * Initialization stages:
	 * 1. Fetch artifact graph from API
	 * 2. Load VFS files (OPFS) + setup BuildAwareVfs
	 * 3. Load RDF state + optional checkpoint restore
	 * 4. Initialize loader backends + register services
	 * 5. Start sandbox connection
	 */
	import { onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	import { createApiClient } from '@pubwiki/api/client';
	import { API_BASE_URL, SANDBOX_SITE_URL } from '$lib/config';
	import {
		loadArtifactGraph,
		discoverEntryNodes,
		findBackendVfsNode,
		findAssetVfsNodes,
		findConnectedStateNode,
		createPubChat,
		createLLMModule,
		createPubWikiModule,
		createSaveCheckpoint,
		createSaveFromQuads,
		type RuntimeGraph,
		type RuntimeNode,
		type LoaderBackend,
		type ConfirmationHandler,
		type PubWikiModuleConfig,
	} from '@pubwiki/flow-core';
	import { computeArtifactCommit, computeContentHash, type GetArtifactGraphResponse } from '@pubwiki/api';
	import { getNodeVfs, disposeAllVfs } from '$lib/vfs/store';
	import { detectStorageBackend } from '$lib/vfs/detect';
	import { getNodeRDFStore, closeAllRDFStores, type RDFStore } from '$lib/rdf/store';
	import { fromRdfQuad, toRdfQuad } from '@pubwiki/rdfstore';
	import { detectProject, createBuildAwareVfs, getOpfsBuildCacheStorage, getIdbBuildCacheStorage, type BuildCacheStorage } from '@pubwiki/bundler';
	import type { ProjectConfig } from '@pubwiki/bundler';
	import { createRemoteBuildFetcher } from '$lib/io/remote-build-fetcher';
	import { fetchAndPopulateVfs } from '@pubwiki/flow-core';
	import { createPlayerRegistry, buildJsModules, initializePlayerLoader } from '$lib/loader';
	import { createPlayerLoaderServices } from '$lib/sandbox';
	import {
		createSandboxConnection,
		type SandboxConnection,
		type ConsoleLogEntry,
	} from '@pubwiki/sandbox-host';
	import type { Vfs } from '@pubwiki/vfs';
	import { useAuth, getSettingsStore } from '@pubwiki/ui/stores';
	import { SandboxContent } from '@pubwiki/flow-core';
	import { getPendingConfirmation, requestConfirmation, respondConfirmation } from '@pubwiki/ui/components';
	import PubWikiConfirmDialog from '$components/pubwiki/PubWikiConfirmDialog.svelte';
	import PublishForm from '$components/pubwiki/PublishForm.svelte';
	import UploadArticleForm from '$components/pubwiki/UploadArticleForm.svelte';
	import UploadCheckpointForm from '$components/pubwiki/UploadCheckpointForm.svelte';
	import UploadCheckpointsForm from '$components/pubwiki/UploadCheckpointsForm.svelte';
	import PlayLoader from '$components/PlayLoader.svelte';
	import PlayError from '$components/PlayError.svelte';

	// ============================================================================
	// API Client + Auth
	// ============================================================================

	const apiClient = createApiClient(API_BASE_URL);
	const auth = useAuth();
	const settings = getSettingsStore();
	const pendingConfirmation = $derived(getPendingConfirmation());

	// ============================================================================
	// Page Data
	// ============================================================================

	let { data }: { data: PageData } = $props();

	// ============================================================================
	// Loading State
	// ============================================================================

	interface LoadingState {
		stage: 'init' | 'fetching-graph' | 'loading-vfs' | 'loading-state' | 'loading-loaders' | 'starting-sandbox' | 'ready' | 'error';
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
	// Runtime State
	// ============================================================================

	let iframeRef = $state<HTMLIFrameElement | null>(null);
	let sandboxConnection = $state<SandboxConnection | null>(null);
	let buildAwareVfs: (Vfs & { warmup(): Promise<void> }) | null = null;
	let backends = new Map<string, LoaderBackend>();
	let rdfStore: RDFStore | null = null;
	let storedGraphData: GetArtifactGraphResponse | null = null;
	let iframeSrc = $state<string>('');
	let consoleLogs = $state<ConsoleLogEntry[]>([]);

	// Runtime-resolved publish metadata (set during initialization)
	let resolvedSandboxNodeId: string | null = null;
	let resolvedBuildCacheKey: string | null = null;

	// User info passed to sandbox via iframe.name
	let userInfo = $state({
		isLoggedIn: false,
		userId: null as string | null,
		username: null as string | null,
		sourceSaveCommit: null as string | null,
		userSaveCommit: null as string | null,
	});

	// Resolved state node ID, needed to create save at publish time
	let resolvedStateNodeId: string | null = null;

	// ============================================================================
	// Publish Support
	// ============================================================================

	/**
	 * Publish the current artifact graph as a new artifact.
	 * Re-uses existing node data and VFS archives (content-addressable in R2).
	 */
	async function playerPublishArtifact(
		metadata: { name: string; slug: string; description?: string; version?: string; isListed?: boolean; isPrivate?: boolean; tags?: string[]; homepage?: string },
		graphData: GetArtifactGraphResponse,
	): Promise<{ success: boolean; artifactId?: string; error?: string }> {
		const newArtifactId = crypto.randomUUID();

		// Convert ArtifactNodeSummary[] → CreateArtifactNode[]
		const nodes = graphData.nodes
			.filter((n) => n.content != null)
			.map((n) => ({
				nodeId: n.id,
				commit: n.commit,
				parent: null as string | null,
				type: n.type,
				name: n.name ?? undefined,
				contentHash: n.contentHash,
				content: n.content!,
				position: n.position,
			}));

		// Always create a fresh save from the current state node
		let newSaveCommit: string | null = null;
		if (resolvedStateNodeId && rdfStore) {
			const artifactCommit = graphData.version?.commitHash;
			const saveResult = await createSaveCheckpoint(
				rdfStore,
				{
					stateNodeId: resolvedStateNodeId,
					artifactId: data.artifactId,
					artifactCommit: artifactCommit ?? '',
				},
				API_BASE_URL,
				{ fromRdfQuad, toRdfQuad },
			);
			if (saveResult.success && saveResult.save) {
				const sd = saveResult.save;
				newSaveCommit = sd.commit;
				const saveContent = {
					type: 'SAVE' as const,
					stateNodeId: sd.stateNodeId,
					artifactId: sd.artifactId,
					artifactCommit: sd.artifactCommit,
					quadsHash: sd.quadsHash,
					title: sd.title ?? null,
					description: sd.description ?? null,
				};
				const contentHash = await computeContentHash(saveContent);
				nodes.push({
					nodeId: sd.saveId,
					commit: sd.commit,
					parent: sd.parent ?? null,
					type: 'SAVE' as const,
					name: undefined,
					contentHash,
					content: saveContent,
					position: undefined,
				});
			}
		}

		const edges = graphData.edges.map((e) => ({
			source: e.source,
			target: e.target,
			sourceHandle: e.sourceHandle ?? undefined,
			targetHandle: e.targetHandle ?? undefined,
		}));

		// Compute artifact commit
		const commitNodes = nodes.map((n) => ({ nodeId: n.nodeId, commit: n.commit }));
		const commitEdges = edges.map((e) => ({
			source: e.source,
			target: e.target,
			sourceHandle: e.sourceHandle ?? null,
			targetHandle: e.targetHandle ?? null,
		}));
		const commit = await computeArtifactCommit(newArtifactId, null, commitNodes, commitEdges);

		// Construct entrypoint: use the freshly created save commit, or fall back to source
		const saveCommit = newSaveCommit ?? userInfo.sourceSaveCommit;
		const entrypoint = saveCommit && resolvedSandboxNodeId
			? { saveCommit, sandboxNodeId: resolvedSandboxNodeId }
			: graphData.version?.entrypoint ?? undefined;

		const apiMetadata = {
			artifactId: newArtifactId,
			commit,
			parentCommit: null,
			name: metadata.name,
			description: metadata.description || undefined,
			isListed: metadata.isListed ?? true,
			isPrivate: metadata.isPrivate ?? false,
			version: metadata.version || '1.0.0',
			tags: metadata.tags && metadata.tags.length > 0 ? metadata.tags : undefined,
			entrypoint,
			buildCacheKey: resolvedBuildCacheKey ?? graphData.version?.buildCacheKey ?? undefined,
		};

		try {
			const { data: result, error, response } = await apiClient.POST('/artifacts', {
				body: {
					metadata: apiMetadata,
					nodes,
					edges,
					_homepage: metadata.homepage,
				},
				bodySerializer: (body) => {
					const formData = new FormData();
					formData.append('metadata', JSON.stringify(body.metadata));
					formData.append('nodes', JSON.stringify(body.nodes));
					formData.append('edges', JSON.stringify(body.edges));

					const homepage = body._homepage as string | undefined;
					if (homepage && homepage.trim().length > 0) {
						formData.append('homepage', new Blob([homepage], { type: 'text/markdown' }), 'homepage.md');
					}

					return formData;
				},
			});

			if (error) {
				return {
					success: false,
					error: error.error || `HTTP ${response.status}`,
				};
			}

			return { success: true, artifactId: result?.artifact?.id ?? newArtifactId };
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}

	// ============================================================================
	// Initialization
	// ============================================================================

	async function initialize() {
		try {
			// Stage 1: Fetch artifact graph
			loadingState = { stage: 'fetching-graph', progress: 10, message: 'Fetching game data...' };

			const { data: graphData, error: graphError } = await apiClient.GET('/artifacts/{artifactId}/graph', {
				params: {
					path: { artifactId: data.artifactId },
					query: { version: 'latest' }
				}
			});

			if (graphError || !graphData) {
				throw new Error('Failed to fetch artifact graph');
			}

			// Store graph data for publish support
			storedGraphData = graphData as GetArtifactGraphResponse;

			// Convert to RuntimeGraph
			const graph = loadArtifactGraph(storedGraphData);
			const sandboxNodeId = graph.entrypoint?.sandboxNodeId || undefined;
			const discovery = discoverEntryNodes(graph, sandboxNodeId);

			const { sandboxNode, vfsNodes, loaderNodes, stateNode } = discovery;

			// Store resolved values for publish support
			resolvedSandboxNodeId = sandboxNode.id;
			resolvedBuildCacheKey = graph.buildCacheKey;
			resolvedStateNodeId = stateNode?.id ?? null;

			if (vfsNodes.length === 0) {
				throw new Error('No VFS node found connected to sandbox');
			}

			// Stage 2: Load VFS + BuildAwareVfs
			loadingState = { stage: 'loading-vfs', progress: 30, message: 'Loading game files...' };

			const mainVfsNode = vfsNodes[0];
			const vfs = await getNodeVfs(data.artifactId, mainVfsNode.id);

			// Fetch VFS content from API and populate OPFS
			await fetchAndPopulateVfs(API_BASE_URL, mainVfsNode.commit, vfs);

			// Detect project configuration
			const projectConfig = await detectProject('/tsconfig.json', vfs);
			if (!projectConfig || !projectConfig.isBuildable) {
				throw new Error('Invalid project configuration');
			}

			// Create BuildAwareVfs (L0: memory → L1: persistent cache → L2: remote → L3: local compile)
			const storageBackend = await detectStorageBackend();
			const buildCacheStorage: BuildCacheStorage = storageBackend === 'opfs'
				? getOpfsBuildCacheStorage()
				: getIdbBuildCacheStorage();
			const remoteFetcher = createRemoteBuildFetcher(API_BASE_URL);
			buildAwareVfs = createBuildAwareVfs({
				sourceVfs: vfs,
				projectConfig,
				buildCacheStorage,
				buildCacheKey: graph.buildCacheKey,
				remoteFetcher,
			});

			// Eagerly resolve all entry files through the cache hierarchy
			// (L1→L2→L3) so compiled output is warm before the sandbox starts.
			loadingState = { stage: 'loading-vfs', progress: 40, message: 'Preparing build...' };
			await buildAwareVfs.warmup();

			// Get sandbox entry file
			const sandboxContent = sandboxNode.content instanceof SandboxContent
				? sandboxNode.content
				: new SandboxContent();
			const entryFile = sandboxContent.entryFile;

			// Stage 3: Load state (RDF store + optional checkpoint restore)
			loadingState = { stage: 'loading-state', progress: 50, message: 'Loading game state...' };

			// Determine which save to load: URL param takes priority, fallback to entrypoint
			const saveCommitToLoad = data.saveCommit ?? graph.entrypoint?.saveCommit ?? null;

			if (stateNode) {
				rdfStore = await getNodeRDFStore(stateNode.id);

				// Restore from save if commit is provided
				if (saveCommitToLoad) {
					await loadSaveData(saveCommitToLoad);
				}
			}

			// Update user info
			userInfo = {
				isLoggedIn: auth.isAuthenticated,
				userId: auth.user?.id ?? null,
				username: auth.user?.displayName ?? auth.user?.username ?? null,
				sourceSaveCommit: saveCommitToLoad,
				userSaveCommit: null,
			};

			// Stage 4: Initialize loader backends
			loadingState = { stage: 'loading-loaders', progress: 65, message: 'Loading services...' };

			const registry = createPlayerRegistry();

			for (const loaderNode of loaderNodes) {
				try {
					// Find backend VFS for this loader
					const backendVfsNodeId = findBackendVfsNode(graph, loaderNode.id);
					if (!backendVfsNodeId) {
						console.warn(`[Play] Loader ${loaderNode.id} has no backend VFS`);
						continue;
					}

					const backendVfsNode = graph.nodes.get(backendVfsNodeId);
					const backendVfs = await getNodeVfs(data.artifactId, backendVfsNodeId);
					if (backendVfsNode) {
						await fetchAndPopulateVfs(API_BASE_URL, backendVfsNode.commit, backendVfs);
					}

					// Find asset VFS mounts
					const assetVfsNodeIds = findAssetVfsNodes(graph, loaderNode.id);
					const assetMounts = new Map<string, Vfs>();
					for (const assetNodeId of assetVfsNodeIds) {
						const assetNode = graph.nodes.get(assetNodeId);
						const assetVfs = await getNodeVfs(data.artifactId, assetNodeId);
						if (assetNode) {
							await fetchAndPopulateVfs(API_BASE_URL, assetNode.commit, assetVfs);
						}
						// Mount at node ID path (simplification — Studio uses mounts config)
						assetMounts.set(`/${assetNodeId}`, assetVfs);
					}

					// Find connected state node for this loader
					const loaderStateNodeId = findConnectedStateNode(graph, loaderNode.id);
					const loaderRdfStore = loaderStateNodeId
						? (loaderStateNodeId === stateNode?.id ? rdfStore : await getNodeRDFStore(loaderStateNodeId))
						: undefined;

					// Build PubWiki module for this loader
					const artifactCommit = (graphData as GetArtifactGraphResponse).version?.commitHash;
					const formComponentMap: Record<string, typeof PublishForm> = {
						publish: PublishForm,
						uploadArticle: UploadArticleForm,
						uploadCheckpoint: UploadCheckpointForm,
						uploadCheckpoints: UploadCheckpointsForm,
					};
					const confirmationHandler: ConfirmationHandler = {
						async confirm(action, initialValues) {
							const FormComponent = formComponentMap[action];
							if (!FormComponent) return initialValues;
							return requestConfirmation(action as 'publish' | 'uploadArticle' | 'uploadCheckpoint' | 'uploadCheckpoints', FormComponent, initialValues as Record<string, unknown>) as Promise<typeof initialValues | null>;
						}
					};
					const quadSerializers = { fromRdfQuad, toRdfQuad };
					const pubwikiConfig: PubWikiModuleConfig = {
						getGraph: () => graph,
						projectId: data.artifactId,
						loaderNodeId: loaderNode.id,
						apiClient,
						getCurrentUserId: () => auth.user?.id ?? null,
						confirmation: confirmationHandler,
						getArtifactContext: async () => ({
							isPublished: true,
							artifactId: data.artifactId,
							artifactCommit: artifactCommit,
						}),
						getRDFStore: async (nodeId: string) => getNodeRDFStore(nodeId),
						createSaveCheckpoint: async (store, options) => {
							const result = await createSaveCheckpoint(
								store,
								options,
								API_BASE_URL,
								quadSerializers,
							);
							if (result.success && result.save) {
								userInfo.userSaveCommit = result.save.commit;
							}
							return result;
						},
						createSaveFromQuads: async (quads, options) => {
							return createSaveFromQuads(
								quads,
								options,
								API_BASE_URL,
								quadSerializers,
							);
						},
						publishArtifact: async (metadata) => {
							return playerPublishArtifact(metadata, storedGraphData!);
						},
					};
					const pubwikiModule = createPubWikiModule(pubwikiConfig);

					// Build JS modules
					const jsModules = await buildJsModules({
						rdfStore: loaderRdfStore ?? undefined,
						stateNodeId: loaderStateNodeId ?? undefined,
						getNodeRDFStore,
						pubwikiModule,
					});

					// Register LLM module (always register so Lua require('LLM') doesn't fail)
					const llmConfig = settings.api.apiKey && settings.api.selectedModel ? {
						apiKey: settings.api.apiKey,
						model: settings.api.selectedModel,
						baseUrl: settings.effectiveBaseUrl,
					} : {};
					const { pubchat, messageStore } = createPubChat({
						llmConfig,
						rdfStore: loaderRdfStore ?? undefined,
					});
					jsModules.set('LLM', { module: createLLMModule(pubchat, messageStore) });

					// Initialize backend
					const { backend, result } = await initializePlayerLoader(
						registry, backendVfs, assetMounts, jsModules, loaderRdfStore
					);

					if (backend && result.success) {
						backends.set(loaderNode.id, backend);
					} else {
						console.warn(`[Play] Loader ${loaderNode.id} init failed:`, result.error);
					}
				} catch (err) {
					console.error(`[Play] Error initializing loader ${loaderNode.id}:`, err);
				}
			}

			// Stage 5: Start sandbox
			loadingState = { stage: 'starting-sandbox', progress: 80, message: 'Starting game...' };

			// Wait for iframe to mount
			await new Promise(resolve => setTimeout(resolve, 100));
			if (!iframeRef) throw new Error('Sandbox iframe not ready');

			// Create custom services from loader backends
			const customServices = backends.size > 0
				? await createPlayerLoaderServices(backends)
				: undefined;

			// Create sandbox connection
			sandboxConnection = createSandboxConnection({
				iframe: iframeRef,
				basePath: '/',
				projectConfig,
				targetOrigin: SANDBOX_SITE_URL,
				entryFile,
				vfs: buildAwareVfs!,
				customServices,
				onLog: (entry) => {
					consoleLogs = [...consoleLogs, entry];
				}
			});

			// Set iframe src AFTER creating connection to avoid missing SANDBOX_READY
			iframeSrc = `${SANDBOX_SITE_URL}/__sandbox.html`;

			const success = await sandboxConnection.waitForReady();
			if (!success) throw new Error('Failed to initialize sandbox');

			loadingState = { stage: 'ready', progress: 100, message: 'Ready!' };

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

	// ============================================================================
	// Save Data Loading
	// ============================================================================

	async function loadSaveData(saveCommit: string) {
		if (!rdfStore) return;

		try {
			const response = await fetch(`${API_BASE_URL}/saves/${encodeURIComponent(saveCommit)}/data`, {
				credentials: 'include'
			});
			if (!response.ok) {
				console.warn('[Play] Failed to download save data:', response.status);
				return;
			}

			const quadsJson = await response.text();
			const apiQuads = JSON.parse(quadsJson);
			const { toRdfQuad } = await import('@pubwiki/rdfstore');
			const rdfQuads = apiQuads.map(toRdfQuad);

			await rdfStore.clear();
			await rdfStore.batchInsert(rdfQuads);
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
		sandboxConnection?.disconnect();
		if (buildAwareVfs) {
			buildAwareVfs.dispose();
			buildAwareVfs = null;
		}
		for (const backend of backends.values()) {
			backend.destroy();
		}
		backends.clear();
		closeAllRDFStores();
		disposeAllVfs();
	});

	// ============================================================================
	// Retry
	// ============================================================================

	function handleRetry() {
		iframeSrc = '';
		loadingState = { stage: 'init', progress: 0, message: 'Retrying...' };
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

	{#if pendingConfirmation}
		<PubWikiConfirmDialog
			type={pendingConfirmation.type}
			FormComponent={pendingConfirmation.formComponent}
			initialValues={pendingConfirmation.initialValues}
			onConfirm={(editedValues) => respondConfirmation(editedValues)}
			onCancel={() => respondConfirmation(null)}
		/>
	{/if}
</div>

<style>
	iframe {
		transition: opacity 0.3s ease-in-out;
	}
</style>
