<script lang="ts">
	/**
	 * UploadOverlay - Reusable upload progress overlay
	 * Shows during file uploads with progress indicator
	 */

	interface Props {
		progress: { current: number; total: number };
	}

	let { progress }: Props = $props();
</script>

<div class="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2 z-10 min-h-24">
	<div class="flex items-center gap-2 text-blue-600">
		<svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
			<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
			<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
		</svg>
		<span class="text-sm font-medium">Uploading...</span>
	</div>
	<div class="text-xs text-gray-500">
		{progress.current} / {progress.total} files
	</div>
	<!-- Progress bar -->
	<div class="w-32 h-1.5 bg-gray-200 rounded-full overflow-hidden">
		<div 
			class="h-full bg-blue-500"
			style="width: {progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%"
		></div>
	</div>
</div>
