<script lang="ts">
	/**
	 * PlayError - Error display for Play mode
	 */

	interface Props {
		message: string;
		onRetry: () => void;
	}

	let { message, onRetry }: Props = $props();
</script>

<div class="fixed inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
	<div class="text-center max-w-md px-6">
		<!-- Error icon -->
		<div class="mb-6">
			<div class="w-20 h-20 mx-auto bg-red-500/20 rounded-full flex items-center justify-center">
				<svg class="w-10 h-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
				</svg>
			</div>
		</div>
		
		<!-- Error title -->
		<h2 class="text-2xl font-bold text-white mb-3">
			Failed to Load
		</h2>
		
		<!-- Error message -->
		<p class="text-gray-400 mb-6">
			{message}
		</p>
		
		<!-- Actions -->
		<div class="flex justify-center gap-4">
			<button
				class="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
				onclick={onRetry}
			>
				Try Again
			</button>
			<a
				href="/"
				class="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
			>
				Go Home
			</a>
		</div>
	</div>
</div>
