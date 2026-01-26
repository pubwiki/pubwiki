<script lang="ts">
	/**
	 * PlayLoader - Loading progress UI for Play mode
	 */

	interface LoadingState {
		stage: 'init' | 'fetching-graph' | 'creating-project' | 'loading-vfs' | 'loading-state' | 'starting-sandbox' | 'ready' | 'error';
		progress: number;
		message: string;
		error?: string;
	}

	interface Props {
		loadingState: LoadingState;
	}

	let { loadingState }: Props = $props();

	const stageMessages: Record<LoadingState['stage'], string> = {
		'init': 'Initializing...',
		'fetching-graph': 'Loading game data...',
		'creating-project': 'Preparing environment...',
		'loading-vfs': 'Loading game files...',
		'loading-state': 'Restoring game state...',
		'starting-sandbox': 'Starting game...',
		'ready': 'Ready!',
		'error': 'Error'
	};
</script>

<div class="fixed inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
	<div class="text-center">
		<!-- Loading animation -->
		<div class="mb-8 relative">
			<div class="w-24 h-24 mx-auto relative">
				<!-- Outer ring -->
				<svg class="w-full h-full animate-spin-slow" viewBox="0 0 100 100">
					<circle
						class="text-gray-700"
						stroke="currentColor"
						stroke-width="4"
						fill="none"
						cx="50"
						cy="50"
						r="44"
					/>
					<circle
						class="text-blue-500"
						stroke="currentColor"
						stroke-width="4"
						fill="none"
						cx="50"
						cy="50"
						r="44"
						stroke-dasharray={276}
						stroke-dashoffset={276 - (276 * loadingState.progress) / 100}
						stroke-linecap="round"
						transform="rotate(-90 50 50)"
					/>
				</svg>
				<!-- Center icon -->
				<div class="absolute inset-0 flex items-center justify-center">
					<svg class="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
				</div>
			</div>
		</div>
		
		<!-- Progress percentage -->
		<div class="text-3xl font-bold text-white mb-2">
			{loadingState.progress}%
		</div>
		
		<!-- Loading message -->
		<p class="text-gray-400 text-sm">
			{loadingState.message || stageMessages[loadingState.stage]}
		</p>
		
		<!-- Stage indicators -->
		<div class="flex justify-center gap-1.5 mt-6">
			{#each ['fetching-graph', 'creating-project', 'loading-vfs', 'loading-state', 'starting-sandbox'] as stage, i}
				{@const stageProgress = ['fetching-graph', 'creating-project', 'loading-vfs', 'loading-state', 'starting-sandbox'].indexOf(loadingState.stage)}
				<div 
					class="w-2 h-2 rounded-full transition-colors duration-300"
					class:bg-blue-500={i <= stageProgress}
					class:bg-gray-600={i > stageProgress}
				></div>
			{/each}
		</div>
	</div>
</div>

<style>
	@keyframes spin-slow {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
	
	.animate-spin-slow {
		animation: spin-slow 3s linear infinite;
	}
</style>
