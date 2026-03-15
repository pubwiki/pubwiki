<script lang="ts">
	/**
	 * UploadCheckpointsForm - Player wrapper with paraglide i18n labels
	 */
	import { UploadCheckpointsForm as SharedForm, type UploadCheckpointsFormLabels } from '@pubwiki/ui/components';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		initialValues: Record<string, unknown>;
		onValuesChange: (values: Record<string, unknown>) => void;
	}

	let { initialValues, onValuesChange }: Props = $props();

	const labels: UploadCheckpointsFormLabels = {
		count: (count: number) => m.player_pubwiki_checkpoints_count({ count }),
		defaultVisibility: m.player_pubwiki_checkpoints_default_visibility(),
		visibilityPublic: m.player_pubwiki_visibility_public(),
		visibilityPrivate: m.player_pubwiki_visibility_private(),
		visibilityUnlisted: m.player_pubwiki_visibility_unlisted(),
		visibilityHint: m.player_pubwiki_checkpoints_visibility_hint(),
	};
</script>

<SharedForm {initialValues} {onValuesChange} {labels} />
