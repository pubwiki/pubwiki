<script lang="ts">
	/**
	 * UploadCheckpointForm - Player wrapper with paraglide i18n labels
	 */
	import { UploadCheckpointForm as SharedForm, type UploadCheckpointFormLabels } from '@pubwiki/ui/components';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		initialValues: Record<string, unknown>;
		onValuesChange: (values: Record<string, unknown>) => void;
	}

	let { initialValues, onValuesChange }: Props = $props();

	const labels: UploadCheckpointFormLabels = {
		name: m.player_pubwiki_checkpoint_name(),
		namePlaceholder: m.player_pubwiki_checkpoint_name_placeholder(),
		description: m.player_pubwiki_checkpoint_description(),
		descriptionPlaceholder: m.player_pubwiki_checkpoint_description_placeholder(),
		visibility: m.player_pubwiki_field_visibility(),
		visibilityPublic: m.player_pubwiki_visibility_public(),
		visibilityPrivate: m.player_pubwiki_visibility_private(),
		visibilityUnlisted: m.player_pubwiki_visibility_unlisted(),
	};
</script>

<SharedForm {initialValues} {onValuesChange} {labels} />
