<script lang="ts">
	import { useSvelteFlow, useUpdateNodeInternals } from '@xyflow/svelte';
	
	interface FlowApi extends ReturnType<typeof useSvelteFlow> {
		updateNodeInternals: ReturnType<typeof useUpdateNodeInternals>;
	}
	
	interface Props {
		onInit?: (flow: FlowApi) => void;
	}
	
	let { onInit }: Props = $props();
	
	const flow = useSvelteFlow();
	const updateNodeInternals = useUpdateNodeInternals();
	
	// Combine both into a single API object
	const flowApi: FlowApi = {
		...flow,
		updateNodeInternals
	};
	
	$effect(() => {
		onInit?.(flowApi);
	});
</script>
