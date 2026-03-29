<script lang="ts">
	import { SettingsModal as SharedSettingsModal } from '@pubwiki/ui/components';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();
</script>

<SharedSettingsModal onclose={() => onClose()} />
