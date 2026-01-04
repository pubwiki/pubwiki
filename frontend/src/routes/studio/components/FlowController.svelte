<script lang="ts">
	import { useSvelteFlow } from '@xyflow/svelte';
	
	interface Props {
		onInit?: (flow: ReturnType<typeof useSvelteFlow>) => void;
	}
	
	let { onInit }: Props = $props();
	
	const flow = useSvelteFlow();
	
	$effect(() => {
		onInit?.(flow);
	});
</script>
